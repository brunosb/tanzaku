use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryEntry {
    pub id: String,
    pub title: String,
    pub file: String,
    pub source_url: Option<String>,
    pub duration: Option<f64>,
    pub added_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_part_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportFailure {
    pub file_name: String,
    pub error: String,
}
#[derive(Debug, Default, Serialize)]
pub(crate) struct ImportReport {
    pub imported: Vec<LibraryEntry>,
    pub failed: Vec<ImportFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Playlist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
    pub created_at: String,
}
