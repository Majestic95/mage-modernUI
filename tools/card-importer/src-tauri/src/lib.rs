use regex::Regex;
use rayon::prelude::*;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRepoScan {
    root_path: String,
    card_classes: Vec<NativeCardClass>,
    set_classes: Vec<NativeSetClass>,
    set_entries: Vec<NativeSetEntry>,
    token_entries: Vec<NativeTokenEntry>,
    image_support_entries: Vec<NativeImageSupportEntry>,
    scan_method: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCardClass {
    card_name: String,
    class_name: String,
    package_letter: String,
    class_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSetClass {
    set_code: String,
    set_name: String,
    set_class_name: String,
    set_path: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSetEntry {
    set_code: String,
    set_name: String,
    set_class_name: String,
    card_name: String,
    collector_number: String,
    rarity: String,
    class_name: String,
    raw_line: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTokenEntry {
    kind: String,
    set_code: String,
    token_name: String,
    image_number: Option<String>,
    class_name: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeImageSupportEntry {
    set_code: String,
    name: String,
    image_number: Option<String>,
    url: String,
}

#[derive(Default)]
struct ParsedFileData {
    card_class: Option<NativeCardClass>,
    set_class: Option<NativeSetClass>,
    set_entries: Vec<NativeSetEntry>,
    token_entries: Vec<NativeTokenEntry>,
    image_support_entries: Vec<NativeImageSupportEntry>,
}

struct CandidateFiles {
    files: Vec<PathBuf>,
    scan_method: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_xmage_repo])
        .run(tauri::generate_context!())
        .expect("error while running XMage Card Importer Workbench");
}

#[tauri::command]
fn scan_xmage_repo(root_path: String) -> Result<NativeRepoScan, String> {
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(format!("Selected path is not a folder: {}", root_path));
    }
    validate_xmage_checkout(&root)?;

    let CandidateFiles {
        files: relative_files,
        scan_method,
    } = list_candidate_files(&root);
    let mut card_classes = Vec::new();
    let mut set_classes: HashMap<String, NativeSetClass> = HashMap::new();
    let mut set_entries = Vec::new();
    let mut token_entries = Vec::new();
    let mut image_support_entries = Vec::new();

    let parsed_files: Vec<ParsedFileData> = relative_files
        .par_iter()
        .map(|relative_path| parse_candidate_file(&root, relative_path))
        .collect();

    for parsed in parsed_files {
        if let Some(card_class) = parsed.card_class {
            card_classes.push(card_class);
        }
        if let Some(set_class) = parsed.set_class {
            set_classes.insert(set_class.set_code.to_uppercase(), set_class);
        }
        set_entries.extend(parsed.set_entries);
        token_entries.extend(parsed.token_entries);
        image_support_entries.extend(parsed.image_support_entries);
    }

    Ok(NativeRepoScan {
        root_path,
        card_classes,
        set_classes: set_classes.into_values().collect(),
        set_entries,
        token_entries,
        image_support_entries,
        scan_method,
    })
}

fn validate_xmage_checkout(root: &Path) -> Result<(), String> {
    let has_mage_sets = root.join("Mage.Sets").is_dir();
    let has_mage_core = root.join("Mage").is_dir();
    if has_mage_sets && has_mage_core {
        return Ok(());
    }

    Err(format!(
        "Selected folder does not look like an XMage checkout: {}. Expected Mage.Sets/ and Mage/ directories.",
        root.display()
    ))
}

fn parse_candidate_file(root: &Path, relative_path: &Path) -> ParsedFileData {
    let absolute_path = root.join(relative_path);
    let text = match fs::read_to_string(&absolute_path) {
        Ok(value) => value,
        Err(_) => return ParsedFileData::default(),
    };
    let normalized_path = normalize_path(relative_path);

    if is_card_class_file(&normalized_path) {
        return ParsedFileData {
            card_class: parse_card_class(&normalized_path, &text),
            ..ParsedFileData::default()
        };
    }
    if normalized_path.starts_with("Mage.Sets/src/mage/sets/") && normalized_path.ends_with(".java") {
        let (set_class, set_entries) = parse_set_file(&normalized_path, &text);
        return ParsedFileData {
            set_class,
            set_entries,
            ..ParsedFileData::default()
        };
    }
    if normalized_path == "Mage/src/main/resources/tokens-database.txt" {
        return ParsedFileData {
            token_entries: parse_token_entries(&text),
            ..ParsedFileData::default()
        };
    }
    if normalized_path.ends_with("ScryfallImageSupportTokens.java")
        || normalized_path.ends_with("ScryfallImageSupportCards.java")
    {
        return ParsedFileData {
            image_support_entries: parse_image_support_entries(&text),
            ..ParsedFileData::default()
        };
    }

    ParsedFileData::default()
}

fn list_candidate_files(root: &Path) -> CandidateFiles {
    match list_git_files(root) {
        Ok(files) => CandidateFiles {
            files: files.into_iter().filter(|path| is_needed_file(path)).collect(),
            scan_method: "git-ls-files+untracked".to_string(),
        },
        Err(error) => {
            let git_error = error.trim().replace(['\r', '\n'], " ");
            let mut files = Vec::new();
            let mut visited_dirs = HashSet::new();
            collect_needed_files(root, root, &mut files, &mut visited_dirs);
            CandidateFiles {
                files,
                scan_method: format!("filtered-filesystem (git unavailable: {git_error})"),
            }
        }
    }
}

fn list_git_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("ls-files")
        .arg("--cached")
        .arg("--others")
        .arg("--exclude-standard")
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().map(PathBuf::from).collect())
}

fn collect_needed_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<PathBuf>,
    visited_dirs: &mut HashSet<PathBuf>,
) {
    if let Ok(canonical) = current.canonicalize() {
        if !visited_dirs.insert(canonical) {
            return;
        }
    }
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        if path.is_dir() {
            if is_candidate_directory(&normalize_path(relative)) {
                collect_needed_files(root, &path, files, visited_dirs);
            }
        } else if is_needed_file(relative) {
            files.push(relative.to_path_buf());
        }
    }
}

fn is_candidate_directory(relative_path: &str) -> bool {
    let path = normalize_slashes(relative_path);
    // Ancestor checks let us walk from repo root to the target folders; descendant
    // checks keep recursion inside those folders once we reach them.
    path.is_empty()
        || "Mage.Sets/src/mage/cards".starts_with(&path)
        || "Mage.Sets/src/mage/sets".starts_with(&path)
        || "Mage/src/main/resources".starts_with(&path)
        || "Mage/src/main/java/mage/cards/basiclands".starts_with(&path)
        || "Mage.Client/src/main/java/org/mage/plugins/card/dl/sources".starts_with(&path)
        || path.starts_with("Mage.Sets/src/mage/cards")
        || path.starts_with("Mage.Sets/src/mage/sets")
        || path.starts_with("Mage/src/main/resources")
        || path.starts_with("Mage/src/main/java/mage/cards/basiclands")
        || path.starts_with("Mage.Client/src/main/java/org/mage/plugins/card/dl/sources")
}

fn is_needed_file(relative_path: &Path) -> bool {
    let path = normalize_path(relative_path);
    is_card_class_file(&path)
        || (path.starts_with("Mage.Sets/src/mage/sets/") && path.ends_with(".java"))
        || path == "Mage/src/main/resources/tokens-database.txt"
        || path == "Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportTokens.java"
        || path == "Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportCards.java"
}

fn is_card_class_file(path: &str) -> bool {
    (path.starts_with("Mage.Sets/src/mage/cards/") && path.ends_with(".java"))
        || (path.starts_with("Mage/src/main/java/mage/cards/basiclands/") && path.ends_with(".java"))
}

fn parse_card_class(path: &str, text: &str) -> Option<NativeCardClass> {
    if abstract_class_regex().is_match(text) {
        return None;
    }
    let class_name = card_class_regex().captures(text)?.get(1)?.as_str().to_string();
    let package_letter = if path.contains("/basiclands/") {
        "basiclands".to_string()
    } else {
        class_name.chars().next()?.to_lowercase().to_string()
    };
    Some(NativeCardClass {
        card_name: class_name.clone(),
        class_name,
        package_letter,
        class_path: path.to_string(),
    })
}

fn parse_set_file(path: &str, text: &str) -> (Option<NativeSetClass>, Vec<NativeSetEntry>) {
    let set_class_name = Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let set_match = set_super_regex().captures(text);
    let set_name = set_match
        .as_ref()
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| set_class_name.clone());
    let set_code = set_match
        .as_ref()
        .and_then(|captures| captures.get(2))
        .map(|value| value.as_str().to_string())
        .unwrap_or_default();
    let set_class = if set_code.is_empty() {
        None
    } else {
        Some(NativeSetClass {
            set_code: set_code.clone(),
            set_name: set_name.clone(),
            set_class_name: set_class_name.clone(),
            set_path: path.to_string(),
        })
    };

    let entries = text
        .lines()
        .filter_map(|line| {
            let captures = set_card_regex().captures(line)?;
            Some(NativeSetEntry {
                set_code: set_code.clone(),
                set_name: set_name.clone(),
                set_class_name: set_class_name.clone(),
                card_name: captures.get(1)?.as_str().to_string(),
                collector_number: captures.get(2)?.as_str().trim_matches('"').to_string(),
                rarity: captures.get(3)?.as_str().to_string(),
                class_name: captures.get(5)?.as_str().to_string(),
                raw_line: line.trim().to_string(),
            })
        })
        .collect();

    (set_class, entries)
}

fn parse_token_entries(text: &str) -> Vec<NativeTokenEntry> {
    text.lines()
        .filter_map(|line| {
            let captures = token_regex().captures(line.trim())?;
            Some(NativeTokenEntry {
                kind: captures.get(1)?.as_str().to_string(),
                set_code: captures.get(2)?.as_str().to_string(),
                token_name: captures.get(3)?.as_str().to_string(),
                image_number: captures
                    .get(4)
                    .map(|value| value.as_str())
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                class_name: captures.get(5)?.as_str().to_string(),
            })
        })
        .collect()
}

fn parse_image_support_entries(text: &str) -> Vec<NativeImageSupportEntry> {
    image_support_regex()
        .captures_iter(text)
        .filter_map(|captures| {
            Some(NativeImageSupportEntry {
                set_code: captures.get(1)?.as_str().to_string(),
                name: captures.get(2)?.as_str().to_string(),
                image_number: captures.get(3).map(|value| value.as_str().to_string()),
                url: captures.get(4)?.as_str().to_string(),
            })
        })
        .collect()
}

fn normalize_path(path: &Path) -> String {
    normalize_slashes(&path.to_string_lossy())
}

fn normalize_slashes(path: &str) -> String {
    path.replace('\\', "/")
}

fn card_class_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"public\s+(?:final\s+)?class\s+(\w+)\s+extends\s+").unwrap())
}

fn abstract_class_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"public\s+abstract\s+class\s+\w+\s+extends\s+").unwrap())
}

fn set_super_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"super\("([^"]+)",\s*"([^"]+)""#).unwrap())
}

fn set_card_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"cards\.add\(new SetCardInfo\("([^"]+)",\s*"?(.*?)"?\s*,\s*Rarity\.(\w+),\s*mage\.cards\.((?:basiclands)|(?:[a-z]))\.(\w+)\.class"#).unwrap()
    })
}

fn token_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"^\|(TOK|EMBLEM|PLANE|DUNGEON):([^|]+)\|([^|]+)\|([^|]*)\|([^|]+)\|$").unwrap())
}

fn image_support_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    // Image support declarations are one put(...) call per Java statement; this
    // intentionally matches each statement rather than spanning arbitrary code.
    REGEX.get_or_init(|| Regex::new(r#"put\("([^/"]+)/([^/"]+)(?:/([^/"]+))?",\s*"([^"]+)"\)"#).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_card_class_skips_abstract_classes_and_reads_basic_land_path() {
        let abstract_card = parse_card_class(
            "Mage.Sets/src/mage/cards/a/AbstractBase.java",
            "package mage.cards.a;\npublic abstract class AbstractBase extends CardImpl {}",
        );
        expect_none(abstract_card);

        let plains = parse_card_class(
            "Mage/src/main/java/mage/cards/basiclands/Plains.java",
            "package mage.cards.basiclands;\npublic final class Plains extends CardImpl {}",
        )
        .expect("Plains should parse");

        assert_eq!(
            plains,
            NativeCardClass {
                card_name: "Plains".to_string(),
                class_name: "Plains".to_string(),
                package_letter: "basiclands".to_string(),
                class_path: "Mage/src/main/java/mage/cards/basiclands/Plains.java".to_string(),
            }
        );
    }

    #[test]
    fn parse_set_file_reads_set_class_and_card_entries() {
        let text = [
            r#"super("Foundations", "FDN", ExpansionSet.buildDate(2024, 11, 15), SetType.EXPANSION);"#,
            r#"cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.COMMON, mage.cards.l.LightningBolt.class));"#,
            r#"cards.add(new SetCardInfo("Plains", "A08", Rarity.LAND, mage.cards.basiclands.Plains.class, NON_FULL_USE_VARIOUS));"#,
        ]
        .join("\n");

        let (set_class, entries) = parse_set_file("Mage.Sets/src/mage/sets/Foundations.java", &text);

        assert_eq!(
            set_class,
            Some(NativeSetClass {
                set_code: "FDN".to_string(),
                set_name: "Foundations".to_string(),
                set_class_name: "Foundations".to_string(),
                set_path: "Mage.Sets/src/mage/sets/Foundations.java".to_string(),
            })
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].card_name, "Lightning Bolt");
        assert_eq!(entries[0].collector_number, "123");
        assert_eq!(entries[0].class_name, "LightningBolt");
        assert_eq!(entries[1].card_name, "Plains");
        assert_eq!(entries[1].collector_number, "A08");
        assert_eq!(entries[1].class_name, "Plains");
    }

    #[test]
    fn parse_token_entries_handles_empty_image_numbers() {
        let entries = parse_token_entries("|TOK:FDN|Goblin||GoblinToken|\n|EMBLEM:ABC|Chandra|1|ChandraEmblem|\n");

        assert_eq!(
            entries,
            vec![
                NativeTokenEntry {
                    kind: "TOK".to_string(),
                    set_code: "FDN".to_string(),
                    token_name: "Goblin".to_string(),
                    image_number: None,
                    class_name: "GoblinToken".to_string(),
                },
                NativeTokenEntry {
                    kind: "EMBLEM".to_string(),
                    set_code: "ABC".to_string(),
                    token_name: "Chandra".to_string(),
                    image_number: Some("1".to_string()),
                    class_name: "ChandraEmblem".to_string(),
                },
            ]
        );
    }

    #[test]
    fn parse_image_support_entries_reads_card_and_token_urls() {
        let entries = parse_image_support_entries(
            r#"
                put("FDN/Goblin", "https://api.scryfall.com/cards/tfdn/1/en?format=image");
                put("TST/Foo/2", "https://api.scryfall.com/cards/tst/2/en?format=image");
            "#,
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].set_code, "FDN");
        assert_eq!(entries[0].name, "Goblin");
        assert_eq!(entries[0].image_number, None);
        assert_eq!(entries[1].set_code, "TST");
        assert_eq!(entries[1].name, "Foo");
        assert_eq!(entries[1].image_number, Some("2".to_string()));
    }

    #[test]
    fn needed_file_filter_includes_untracked_scan_targets() {
        assert!(is_needed_file(Path::new("Mage.Sets/src/mage/cards/l/LightningBolt.java")));
        assert!(is_needed_file(Path::new("Mage/src/main/java/mage/cards/basiclands/Plains.java")));
        assert!(is_needed_file(Path::new("Mage.Sets/src/mage/sets/Foundations.java")));
        assert!(is_needed_file(Path::new("Mage/src/main/resources/tokens-database.txt")));
        assert!(!is_needed_file(Path::new("webclient/src/App.tsx")));
    }

    #[test]
    fn checkout_validation_rejects_wrong_folder() {
        let root = std::env::temp_dir().join(format!(
            "xmage-card-importer-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp root");

        assert!(validate_xmage_checkout(&root).is_err());

        fs::create_dir(root.join("Mage")).expect("Mage dir");
        fs::create_dir(root.join("Mage.Sets")).expect("Mage.Sets dir");
        assert!(validate_xmage_checkout(&root).is_ok());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn regexes_compile_at_test_time() {
        let _ = card_class_regex();
        let _ = abstract_class_regex();
        let _ = set_super_regex();
        let _ = set_card_regex();
        let _ = token_regex();
        let _ = image_support_regex();
    }

    fn expect_none<T>(value: Option<T>) {
        assert!(value.is_none());
    }
}
