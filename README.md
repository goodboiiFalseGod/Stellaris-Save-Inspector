# Stellaris Save Inspector

Keep this repository outside the game installation. Double-click `start.cmd`; it starts a hidden local server with built-in Windows PowerShell and opens [http://127.0.0.1:8765/SaveInspector/](http://127.0.0.1:8765/SaveInspector/) in current Chrome or Microsoft Edge. Open **Папка игры**, enter the full path to the Stellaris installation, and save it. The path is kept in the Git-ignored `settings.local.json` between sessions. Node.js is not required. The tool processes the archive entirely in the browser and does not upload it. The local server loads original Stellaris assets from the selected installation.

It currently reads standard ZIP-based, text `gamestate` saves and shows regular empires, government/authority, origin, civics, founder species and its traits, stored resources, owned planet count, country ID, plus save metadata. It decodes compatible game `.dds` assets for flags, origins, civics, and traits; visible symbols remain as a fallback if a modded or unsupported texture cannot be read. Encrypted/binary Ironman saves are reported as unsupported instead of being misread.

The background and other game graphics are loaded from the selected installation, not copied into this repository. Restart the page after changing the game path (the settings button does this automatically).

## Interface and filters

Cards use a compact summary and separate wrapping rows for civics and species traits. Resource amounts have the original game icons and one decimal place. Flags combine the saved background and colors with the original emblem, mask, and frame using the game's 64-pixel flag layout.

Category switches independently show Players, AI empires, Pre-FTL, Enclaves, and Other countries. Players and ordinary AI empires are enabled by default. `Players only` hides every non-player country; `Show all` enables every category. Player ownership comes from the save's `player` table, not from a network/online status check. Search and sorting work within the chosen categories.

## Galaxy map

The map tab draws owned-system borders from starbase ownership, hyperlanes, military fleets, arkships and waystations. Neutral objects (Pre-FTL, enclaves, leviathans) remain as optional markers. **Wanderlust** marks systems that the nomad exploration chain cares about, using star flags such as `ancient_wonders_system` and `galactic_landmark_system`. Gold stars are unvisited; green stars were already visited by a nomadic arkship (`visited_by_nomad`). Its route planner can either collect the most sites or approximately minimize travel needed to reach four completed Wanderlust categories, using the saved per-category requirements and progress. Threat avoidance is split into minor systems (combined hostile power up to and including 3× the capital arkship) and major systems (above 3×); unknown strength follows the major setting. Turn on **Perspective** and pick an empire to highlight its systems and, with **Hostile systems**, tint stars that would be aggressive for it: war and `hostile` relations in red, closed borders in orange. Click a system or marker for details. Borders are Voronoi cells around each owned star, with outlines only where ownership changes. Territory paint uses the flag's dedicated border/fill map colors when present, falling back to its primary/secondary colors from `flags/colors.txt`.

Missing or unsupported textures keep a placeholder and generate a visible warning; this can occur with older saves or modded assets. DDS decoding supports uncompressed 24-bit and 32-bit textures.

## English names and fleet composition

Names load from the installed game's English localization, including species, empire formats, government names and fleet name lists. Nested save variables, case-insensitive adjective placeholders and localization references are resolved; literal custom names retain their original spelling. English files are loaded once per page session using `english-files.json`, a manifest of the current installation's localization files. If a game update removes or adds these files, the manifest must be refreshed. A missing file produces an explicit loading error. Mod-only keys and unsupported dynamic expressions remain visible as raw keys/expressions rather than fabricated names; mod localization is not loaded.

Expand **Fleet composition** on an empire card to see military fleets and counts by hull type, such as `3 Corvettes` or `3 Battleships`. Only military fleets contribute to the main fleet count. Composition follows `fleets_manager.owned_fleets` → the root `fleet` table → root `ships` → the current design's hull type. Legacy saves use `ship_design` and a direct `ship_size`; newer saves use `ship_design_implementation.design` with the zero-based `growth_stage` selecting an entry in the design's `growth_stages`. Upgrade targets are never used as current hulls. Duplicate references are counted once, genuinely missing hull data shows `Unknown hull type`, and missing fleet records are reported separately from empty fleets.

The fleet list follows the in-game outliner, with compact two-line military entries showing a hull icon, fleet name, current system, ship count and saved military power. Click a fleet (or press Enter/Space on its summary) to expand an in-game-style panel with the empire flag, aggregate hull/armor/shield condition and ships grouped by hull type. Hull groups start collapsed and can be expanded. Ship rows show localized ship names, hull types (for example `Cruiser`) and three vertical condition bars; the design/project name stays off the row. Click a ship to load its saved template: section slots, weapons and the design name. The roster is rendered only when the fleet is opened; a ship's template is rendered only when that ship is opened. Long rosters scroll within the panel.

Class icons and silhouettes use the original sprite-sheet frames selected through the installed `common/ship_sizes` definitions and `interface/icons.gfx`. The ship-row background and statistic icons are also original game assets. `ship-size-files.json` lists the installed ship-size definition files. A missing/modded icon keeps a visible fallback and warning.

Power comes from the fleet's saved `military_power`; current system comes from its movement coordinate (not its destination), with ship coordinates as fallback when no fleet coordinate was saved. Hull, armor and shield percentages use saved current/max hit points, weighted by maximum points when aggregated. Missing values show `—`, unequipped defenses show `N/A`, and their bars are hatched instead of pretending to be full. Ship count is explicitly labeled and is not naval usage or command limit. The panel is read-only: it does not imitate operational orders, upgrades or disband buttons.

## Combat overview

The hull summary merges internal hull IDs with the same English plural label and sums their counts; detailed ship rosters retain their actual hull IDs. Weapons use compact original-game icon tiles, with slot-size and count overlays and hover/keyboard-focus descriptions. `weapon-icons.json` maps component sprite names to locally installed DDS files, including expansion subfolders; missing artwork keeps a fallback. Armor and shield counts combine all sizes of the same component.

**Combat overview** is available above an empire's fleet list and inside each expanded fleet. It covers only retained ships and their current saved designs/growth stages, not upgrade targets. Weapons are listed by family and slot size (S/M/L and special slots), sorted by installed count; different sizes are never merged. It also shows fitted PD/flak versus section PD slots including empty slots, and base armor/shield damage multipliers and penetration averaged per non-PD mount. These are descriptive equipment averages, not DPS or predicted combat results; weapon size, fire rate, evasion, empire bonuses, target size and combat-computer behavior are not simulated.

Range is averaged per non-PD mount. Ordinary guns use CSV `range`; strike-craft hangars use the template `engagement_range` (not attack `range`). The short/medium/long classification uses ≤40, 41–80, and >80; a category needs more than half the covered mounts, otherwise the fleet is mixed. Hangar damage multipliers and penetration come from the strike-craft template, with omitted fields using the game defaults (×1 damage, 0% penetration). Defense focus uses summed saved maximum armor/shield HP.

Ship speed shows two separate min/mean/max summaries. The equipment estimate uses the installed hull's `max_speed` and fitted components: `max_speed × (1 + ship_base_speed_mult) × (1 + ship_speed_mult)`, with each modifier summed across fitted components. This is not the full in-game maximum: excess power, empire/commander/system bonuses, damage penalties and effects outside the fitted design are not included. Saved movement is displayed separately as `speed / SHIP_SPEED_SCALE`, using the installed game's define (currently `0.045`), rather than reporting the raw movement value as a ship statistic. Movement can be below maximum; zero is valid, while missing values stay unknown. Neither summary describes FTL speed.

Fitted armor and shields have separate lists showing component name, slot size and installed count. Standard ARMOR_1–5 and SHIELD_1–5 use their component marks I–V, not prerequisite research tiers: armor V must not appear as armor 4. Special components retain their localized names without an invented mark. No misleading average of armor and shield research tiers is displayed. Commander levels use assigned commanders/admirals referenced by retained ships, fleets or current fleet locations; each leader ID is counted once in the empire aggregate. Missing commanders are not assigned level zero.

Every estimate includes coverage; unresolved components/sections are counted explicitly. Innate/mutation effects outside the saved design are not included. Definitions load locally using `combat-files.json` plus the game's weapon CSV tables. Refresh the manifest if installed files change.

## Military-only filtering and total power

Station/civilian fleet flags and installed ship-type definitions exclude mining/research stations, waystations, starbases, orbital/defense platforms, logistics, constructors, ordinary science ships, colony ships and variants, and army transports. Juggernauts and all mobile arkships (civilian, scientific and military, all tiers) remain included. Arkships are also retained in fleets marked civilian; actual stations remain excluded. Their saved power contributes to the total and ranking. Utility ships inside mixed fleets are removed individually; fleets containing only excluded ships disappear. Unknown mod classes use fleet flags and recognizable utility identifiers as fallback; absent fleet records remain visible as unavailable.

**Fleet power** on each empire card sums its retained military fleets, with the game's power icon and a full-value tooltip. **Highest fleet power** sorts descending using the unrounded sum; unknown totals sort last. No military fleets means zero. If a retained fleet has missing power or a fleet record is absent, the total shows `—` and the tooltip gives the known subtotal. For mixed fleets, military-only power uses saved per-ship `military_power` when available; otherwise it is unknown. The original mixed-fleet total is never counted as military-only power after utility ships are removed.

Regression checks: `node tests.cjs` from this repository after choosing the game path, or with `STELLARIS_GAME_DIR` set to the game installation.

## Economic and technological power

**Economy** and **Technology** on each empire card are the game's own empire ratings, shown as the diplomacy-screen icons plus the number. They come verbatim from the country's saved `economy_power` and `tech_power`. Planets and fleet power use the same icon-and-number layout in a single column; the full name stays in the tooltip.

**Highest economic power** and **Highest technological power** sort descending on the unrounded values, with countries that have no saved rating last, matching how fleet power sorts. Values nested inside other blocks are ignored; only the country's own top-level keys count. A country without these keys shows `—` and says so in the tooltip instead of showing zero. Both follow the tool's usual one-decimal display, so the game's two-decimal `407.50` appears as `407.5`.

## Technology planner

The **Technologies** top-level tab reads all installed `common/technology/*.txt`, tier definitions and scripted weight variables from this local Stellaris 4.5 installation. Pick an empire, then search by technology ID or name to set a target. Physics, Society and Engineering have separate tabs. The tree is deliberately bottom-up: tier 0 is at the bottom and higher tiers appear above it; each card lists its prerequisite branches.

The planner reads the country's saved `tech_status`, saved alternative cards, country flags, modifiers, ethics, government civics/authority and origin. `Mark researched` is a session-only overlay for exploring a non-optimal choice; it never modifies the save. Recommendations prioritize prerequisites for the target, then estimate deck cleanup: studying a card removes it from the draw pool, while newly unlocked off-path cards count as dilution.

This is a best-effort rules evaluator, not a replacement for the game scripting engine. It evaluates technology/flag/civic/ethic/authority/origin/trait checks and Boolean `AND`/`OR`/`NOR`/`NOT`, plus supported weight factors and additions. Unsupported scripted, world, leader, DLC, event and numerical/date triggers are shown as **unknown** and make a card striped rather than being presented as an exact chance. Tier gates and prerequisites are still displayed. No technology tree assets or runtime are downloaded; definitions and localization use the installed game.

Regression checks include `node technology-tests.cjs`.

## Resource values

Each icon shows **stockpile + monthly net** (green surplus / red deficit), for example `3,200 +57.9`. Hover for stored amount, gross income, expenses and the exact save paths used. Large stockpiles are abbreviated; the tooltip keeps the full value.

Stockpiles are read explicitly from `modules.standard_economy_module.resources`, with a direct country `resources` block as fallback. Monthly net sums `budget.current_month.balance` categories, or subtracts expenses from income if the balance is absent. Physics, society and engineering research use the same stockpile and monthly-net layout as the other resources. The last-month budget is used only when the current one has no usable monthly data and is identified in the tooltip. One-off `extra_*` amounts are not included in monthly net. Missing entire sections display `—`; omitted resource keys within an available resource map count as zero.
