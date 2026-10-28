use std::collections::HashMap;

pub fn parse_local_cache_text(text: &str) -> Result<HashMap<String, String>, String> {
    let mut values: HashMap<String, String> = HashMap::new();
    let mut last_key: Option<String> = None;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line = raw_line.trim();
        if line.is_empty() {
            last_key = None;
            continue;
        }
        let separator = line.find('=');
        let key = separator.map(|index| line[..index].trim()).unwrap_or("");
        if separator.is_none() || key.is_empty() {
            let Some(last) = last_key.clone() else {
                return Err(format!("login cache line {}: expected key=value", index + 1));
            };
            if let Some(existing) = values.get_mut(&last) {
                existing.push('\n');
                existing.push_str(line);
            }
            continue;
        }
        let upper = key.to_uppercase();
        values.insert(upper.clone(), line[separator.expect("checked") + 1..].trim().to_string());
        last_key = Some(upper);
    }
    Ok(values)
}

pub fn format_local_cache_text(values: &HashMap<String, String>) -> String {
    values.iter().map(|(key, value)| format!("{key} = {value}")).collect::<Vec<_>>().join("\n")
}

pub fn split_h5_store_entries(
    values: &HashMap<String, String>,
    map_values: &HashMap<String, String>,
    file_values: &HashMap<String, String>,
) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut next_map = HashMap::new();
    let mut next_file = HashMap::new();
    for (key, value) in values {
        if map_values.contains_key(key) && !file_values.contains_key(key) {
            next_map.insert(key.clone(), value.clone());
        } else {
            next_file.insert(key.clone(), value.clone());
        }
    }
    (next_map, next_file)
}
