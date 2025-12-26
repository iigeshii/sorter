import csv
import json
import sys
from pathlib import Path
from string import ascii_uppercase
from typing import Dict, List, Tuple
from typing import Any


CATEGORIES_JSON = Path("categories.json")
LAYOUT_JSON = Path("category_layout.json")
OUTPUT_CSV = Path("sorter_layout.csv")
BIN_CAPACITY = 9  # 3x3 pod


def load_json(path: Path) -> object:
    if not path.exists():
        raise FileNotFoundError(f"Could not find: {path.resolve()}")
    return json.loads(path.read_text(encoding="utf-8").lstrip("\ufeff"))

def load_json_no_dupe_keys(path: Path) -> Any:
    """
    Load JSON and fail if the same object key appears twice.
    This prevents silent overwrites (Python json normally keeps the last).
    """
    if not path.exists():
        raise FileNotFoundError(f"Could not find: {path.resolve()}")

    raw = path.read_text(encoding="utf-8").lstrip("\ufeff")

    def no_dupes_object_pairs_hook(pairs):
        obj = {}
        seen = set()
        dupes = []
        for k, v in pairs:
            if k in seen:
                dupes.append(k)
            seen.add(k)
            obj[k] = v
        if dupes:
            # report unique dupes in stable order
            uniq = []
            for d in dupes:
                if d not in uniq:
                    uniq.append(d)
            raise ValueError(
                f"Duplicate JSON keys found in {path.name}: " + ", ".join(repr(x) for x in uniq)
            )
        return obj

    return json.loads(raw, object_pairs_hook=no_dupes_object_pairs_hook)

def load_categories(path: Path) -> dict[str, list[str]]:
    data = load_json_no_dupe_keys(path)
    if not isinstance(data, dict):
        raise TypeError(f"{path.name} must be a JSON object (dict) at top level.")
    for k, v in data.items():
        if not isinstance(k, str):
            raise TypeError(f"{path.name}: keys must be strings. Bad key: {k!r}")
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise TypeError(f"{path.name}: values must be list[str]. Bad value for {k!r}.")
    return data


def load_layout(path: Path) -> dict[str, list[str]]:
    data = load_json_no_dupe_keys(path)
    if not isinstance(data, dict):
        raise TypeError(f"{path.name} must be a JSON object (dict) at top level.")
    for k, v in data.items():
        if not isinstance(k, str):
            raise TypeError(f"{path.name}: keys must be strings. Bad key: {k!r}")
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise TypeError(f"{path.name}: values must be list[str] of bins. Bad value for {k!r}.")
    return data


def validate_same_categories(categories: Dict[str, List[str]], layout: Dict[str, List[str]]) -> None:
    cat_set = set(categories.keys())
    layout_set = set(layout.keys())

    only_in_categories = sorted(cat_set - layout_set, key=str.casefold)
    only_in_layout = sorted(layout_set - cat_set, key=str.casefold)

    if only_in_categories or only_in_layout:
        print("\n[ERROR] Category mismatch between JSON files.\n")
        if only_in_categories:
            print(f"Present in {CATEGORIES_JSON.name} but missing in {LAYOUT_JSON.name}:")
            for c in only_in_categories:
                print(f"  - {c}")
            print()
        if only_in_layout:
            print(f"Present in {LAYOUT_JSON.name} but missing in {CATEGORIES_JSON.name}:")
            for c in only_in_layout:
                print(f"  - {c}")
            print()
        sys.exit(2)


def validate_layout_bins_unique(layout: Dict[str, List[str]]) -> None:
    # duplicates within a category
    category_dupes: Dict[str, List[str]] = {}
    for category, bins in layout.items():
        seen = set()
        dupes = []
        for b in bins:
            if b in seen and b not in dupes:
                dupes.append(b)
            seen.add(b)
        if dupes:
            category_dupes[category] = dupes

    # overlaps across categories
    bin_to_categories: Dict[str, List[str]] = {}
    for category, bins in layout.items():
        for b in bins:
            bin_to_categories.setdefault(b, []).append(category)

    overlaps = {b: cats for b, cats in bin_to_categories.items() if len(cats) > 1}

    if category_dupes or overlaps:
        print("\n[ERROR] Invalid bin assignments in category_layout.json.\n")

        if category_dupes:
            print("Duplicate bins listed within the same category:")
            for category in sorted(category_dupes.keys(), key=str.casefold):
                dupes = ", ".join(sorted(category_dupes[category], key=str.casefold))
                print(f"  - {category}: {dupes}")
            print()

        if overlaps:
            print("Bins assigned to multiple categories:")
            for b in sorted(overlaps.keys(), key=str.casefold):
                cats = ", ".join(sorted(overlaps[b], key=str.casefold))
                print(f"  - {b}: {cats}")
            print()

        sys.exit(3)


def parse_bin(bin_id: str) -> tuple[str, int]:
    """
    'A1' -> ('A', 1)
    'X2' -> ('X', 2)
    """
    if len(bin_id) != 2 or bin_id[0] not in ascii_uppercase or bin_id[1] not in ("1", "2"):
        raise ValueError(f"Invalid bin id: {bin_id!r} (expected like 'A1' or 'X2')")
    return bin_id[0], int(bin_id[1])


def generate_all_bins(start_letter: str = "A", end_letter: str = "X") -> List[str]:
    # order: A1, A2, B1, B2, ...
    start_idx = ascii_uppercase.index(start_letter)
    end_idx = ascii_uppercase.index(end_letter)
    letters = ascii_uppercase[start_idx:end_idx + 1]
    bins: List[str] = []
    for letter in letters:
        bins.append(f"{letter}1")
        bins.append(f"{letter}2")
    return bins


def build_bin_to_category(all_bins: List[str], layout: Dict[str, List[str]]) -> Dict[str, str]:
    """
    Returns mapping bin -> category. Unassigned bins are labeled "UNUSED".
    """
    bin_to_category = {b: "UNUSED" for b in all_bins}
    for category, bins in layout.items():
        for b in bins:
            if b not in bin_to_category:
                raise ValueError(f"[ERROR] Layout bin {b!r} is outside the generated range (A1..X2).")
            bin_to_category[b] = category
    return bin_to_category


def fill_bins_for_category(items: List[str], bins: List[str]) -> Dict[str, List[str]]:
    """
    Fill up to BIN_CAPACITY items per bin, in order of bins list.
    Returns bin -> list of up to 9 items.
    """
    items_sorted = sorted(items, key=str.casefold)
    capacity = len(bins) * BIN_CAPACITY
    if len(items_sorted) > capacity:
        raise ValueError(
            f"Not enough capacity: {len(items_sorted)} items but only {capacity} slots "
            f"across bins {bins}."
        )

    out: Dict[str, List[str]] = {b: [] for b in bins}
    i = 0
    for b in bins:
        out[b] = items_sorted[i : i + BIN_CAPACITY]
        i += BIN_CAPACITY
        if i >= len(items_sorted):
            break
    return out


def build_full_sorter(
    categories: Dict[str, List[str]],
    layout: Dict[str, List[str]],
    all_bins: List[str],
) -> Dict[str, Dict[str, object]]:
    """
    Returns per-bin record:
      {
        "A1": {"category": "Utilities", "items": ["...", ...]},
        "A2": {"category": "...", "items": [...]},
        ...
      }
    """
    bin_to_category = build_bin_to_category(all_bins, layout)

    # Pre-fill structure
    sorter: Dict[str, Dict[str, object]] = {}
    for b in all_bins:
        sorter[b] = {"category": bin_to_category[b], "items": []}

    # Fill bins category-by-category, using the bin order specified in layout[category]
    for category, bins in layout.items():
        filled = fill_bins_for_category(categories[category], bins)
        for b in bins:
            sorter[b]["items"] = filled.get(b, [])

    return sorter


def write_exhaustive_chest_csv(
    sorter: Dict[str, Dict[str, object]],
    all_bins: List[str],
    out_path: Path = OUTPUT_CSV,
) -> None:
    """
    Output one row per chest position, e.g. A1-1 .. A1-9 .. X2-9
    Columns:
      #, ChestID, Column, Cluster, Number, Categories, Description, Locked, Framed
    """
    headers = ["#", "ChestID", "Column", "Cluster", "Number", "Categories", "Description", "Locked", "Framed"]

    out_path.parent.mkdir(parents=True, exist_ok=True)

    counter = 1  # <-- running chest index

    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)

        for bin_id in all_bins:
            col_letter, cluster_num = parse_bin(bin_id)

            category = str(sorter[bin_id]["category"])
            items: List[str] = list(sorter[bin_id]["items"])  # up to 9 items

            # Ensure exactly 9 slots per bin
            items = items + [""] * (BIN_CAPACITY - len(items))

            for slot_num in range(1, BIN_CAPACITY + 1):
                chest_id = f"{bin_id}-{slot_num}"
                desc = items[slot_num - 1]

                w.writerow([
                    counter,        # #
                    chest_id,       # ChestID (A1-1)
                    col_letter,     # Column (A)
                    cluster_num,    # Cluster (1 or 2)
                    slot_num,       # Number (1..9)
                    category,       # Categories (or UNUSED)
                    desc             # Description (blank if unused)
                ])

                counter += 1

    print(f"Wrote: {out_path.resolve()}")



def main() -> None:
    categories = load_categories(CATEGORIES_JSON)
    layout = load_layout(LAYOUT_JSON)

    validate_same_categories(categories, layout)
    validate_layout_bins_unique(layout)

    all_bins = generate_all_bins("A", "X")
    sorter = build_full_sorter(categories, layout, all_bins)

    # Output
    write_exhaustive_chest_csv(sorter, all_bins, OUTPUT_CSV)


if __name__ == "__main__":
    main()
