#!/usr/bin/env python3
"""Prepare local Steam files for the browser and dedicated server."""
import argparse
import re
import shutil
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

GAME_DIRS = ("valve", "cstrike")
ASSET_DIRS = {"detail", "events", "gfx", "maps", "media", "models", "overviews", "resource", "sound", "sprites"}
ASSET_TYPES = {
    ".bmp", ".bsp", ".dds", ".fnt", ".jpg", ".jpeg", ".lmp", ".lst", ".mdl",
    ".mp3", ".nav", ".ogg", ".pcx", ".png", ".res", ".sc", ".spr", ".tga",
    ".ttf", ".txt", ".vdf", ".wad", ".wav",
}
ROOT_FILES = {"autobuy.txt", "commandmenu.txt", "delta.lst", "gameinfo.txt", "liblist.gam", "rebuy.txt", "titles.txt"}
ROOT = Path(__file__).resolve().parent.parent
BROWSER_FONTS = ROOT / "game/engine/3rdparty/extras/xash-extras/gfx/fonts"
FONT_NAMES = {"firasans-regular.ttf": "FiraSans-Regular.ttf", "tahoma.ttf": "tahoma.ttf"}


def prepare(source: Path, map_name: str, target: Path) -> int:
    required = ("valve/gfx.wad", "cstrike/liblist.gam", f"cstrike/maps/{map_name}.bsp")
    if any(not (source / name).is_file() for name in required):
        raise ValueError(f"Point STEAM_HALF_LIFE at the Half-Life directory containing valve and cstrike with map {map_name}.")

    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temporary_directory:
        staging = Path(temporary_directory) / "game-data"
        staging.mkdir()
        files = []
        for game in GAME_DIRS:
            game_dir = source / game
            if game_dir.is_symlink():
                raise ValueError(f"Expected a regular game directory: {game_dir}")
            for file in sorted(game_dir.rglob("*")):
                if not file.is_file() or file.is_symlink():
                    continue
                relative = file.relative_to(game_dir)
                parts = [part.lower() for part in relative.parts]
                if any(part.startswith(".") or re.search(r'[\\\x00-\x1f\x7f?#:]', part) for part in parts):
                    continue
                extension = file.suffix.lower()
                if len(parts) == 1:
                    if parts[0] not in ROOT_FILES and extension != ".wad":
                        continue
                elif parts[0] not in ASSET_DIRS or extension not in ASSET_TYPES:
                    continue
                if parts[:2] == ["gfx", "fonts"] and len(parts) == 3:
                    parts[-1] = FONT_NAMES.get(parts[-1], parts[-1])
                asset_name = "/".join([game, *parts])
                destination = staging / asset_name
                if destination.exists():
                    raise ValueError(f"Duplicate game file: {asset_name}")
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, destination)
                files.append(asset_name)

        for font in FONT_NAMES.values():
            filename = f"cstrike/gfx/fonts/{font}"
            destination = staging / filename
            if not destination.is_file():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(BROWSER_FONTS / font, destination)
                files.append(filename)

        if any(not (staging / name).is_file() for name in required) or not any((staging / game / "delta.lst").is_file() for game in GAME_DIRS):
            raise ValueError("The prepared files are missing a required asset.")
        archive = Path(temporary_directory) / "valve.zip"
        with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=1) as package:
            for filename in files:
                package.write(staging / filename, filename)
        previous = Path(temporary_directory) / "previous"
        if target.exists():
            target.rename(previous)
        try:
            staging.rename(target)
            archive.replace(target.parent / "valve.zip")
        except OSError:
            if target.exists():
                target.rename(staging)
            if previous.exists():
                previous.rename(target)
            raise
    return len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("map_name")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9_-]+", args.map_name):
        parser.error("map name must use lowercase letters, numbers, hyphens or underscores")
    target = ROOT / "website/public/game-data"
    source = args.source.resolve()
    if source == ROOT or source.is_relative_to(target) or target.is_relative_to(source):
        parser.error("use a Steam installation outside the generated game data directory")
    try:
        count = prepare(source, args.map_name, target)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(f"Prepared {count} game files in website/public/valve.zip and game-data/.")


if __name__ == "__main__":
    main()
