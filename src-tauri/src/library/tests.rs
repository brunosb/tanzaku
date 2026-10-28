use super::files::write_library;
use super::settings::SELECTED_ROOT;
use super::*;
use std::{fs, path::PathBuf, sync::MutexGuard};
struct Scope {
    _guard: MutexGuard<'static, ()>,
    dir: tempfile::TempDir,
    previous: Option<PathBuf>,
}
impl Scope {
    fn new() -> Self {
        let guard = transaction().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let previous = SELECTED_ROOT.lock().unwrap().replace(dir.path().to_owned());
        Self {
            _guard: guard,
            dir,
            previous,
        }
    }
    fn midi(&self) -> PathBuf {
        let file = self.dir.path().join("original.mid");
        crate::transcription::decoder::write_midi(
            &file,
            &[crate::transcription::decoder::NoteEvent {
                start_frame: 2,
                end_frame: 30,
                pitch: 60,
                velocity: 100,
                pitch_bends: vec![],
            }],
        )
        .unwrap();
        file
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        *SELECTED_ROOT.lock().unwrap() = self.previous.take();
    }
}
#[test]
fn rename_preserves_playlist_id_and_reimport_has_new_id() {
    let scope = Scope::new();
    let source = scope.midi();
    let original = import_midi(&source).unwrap();
    let lists = vec![Playlist {
        id: "p".into(),
        name: "p".into(),
        track_ids: vec![original.id.clone()],
        created_at: "".into(),
    }];
    write_playlists(&lists).unwrap();
    let renamed = rename_midi(&original.id, "renamed").unwrap();
    assert_eq!(renamed.id, original.id);
    assert_eq!(
        read_playlists().unwrap()[0].track_ids.as_slice(),
        std::slice::from_ref(&renamed.id)
    );
    assert!(midi_path(&renamed.file).unwrap().is_file());
    let next = import_midi(&source).unwrap();
    assert_ne!(next.id, renamed.id);
}
#[test]
fn invalid_json_is_preserved_and_import_cannot_overwrite_it() {
    let scope = Scope::new();
    let source = scope.midi();
    let file = scope.dir.path().join("library.json");
    fs::write(&file, b"{broken").unwrap();
    assert!(read_library().is_err());
    assert!(import_midi(&source).is_err());
    assert_eq!(fs::read(file).unwrap(), b"{broken");
}
#[test]
fn atomic_write_replaces_valid_json_and_missing_file_is_empty() {
    let scope = Scope::new();
    assert!(read_library().unwrap().is_empty());
    write_library(&[]).unwrap();
    write_library(&[]).unwrap();
    assert_eq!(
        fs::read_to_string(scope.dir.path().join("library.json"))
            .unwrap()
            .trim(),
        "[]"
    );
}
#[test]
fn playlist_bulk_add_is_atomic_and_reorder_preserves_all_references() {
    let scope = Scope::new();
    let a = import_midi(&scope.midi()).unwrap();
    let b = import_midi(&scope.midi()).unwrap();
    write_playlists(&[Playlist {
        id: "p".into(),
        name: "P".into(),
        track_ids: vec!["missing".into(), a.id.clone()],
        created_at: "".into(),
    }])
    .unwrap();
    let file = scope.dir.path().join("playlists.json");
    let before = fs::read(&file).unwrap();
    assert!(add_playlist_tracks("p", &[b.id.clone(), "invalid".into()]).is_err());
    assert_eq!(fs::read(&file).unwrap(), before);
    let added = add_playlist_tracks("p", &[a.id.clone(), b.id.clone(), b.id.clone()]).unwrap();
    assert_eq!(
        added.track_ids,
        vec!["missing".to_string(), a.id.clone(), b.id.clone()]
    );
    let before = fs::read(&file).unwrap();
    for invalid in [
        vec![a.id.clone(), b.id.clone()],
        vec!["missing".into(), a.id.clone(), a.id.clone()],
        vec!["missing".into(), a.id.clone(), b.id.clone(), "extra".into()],
    ] {
        assert!(reorder_playlist("p", &invalid).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
    }
    let order = vec![b.id, "missing".into(), a.id];
    reorder_playlist("p", &order).unwrap();
    assert_eq!(read_playlists().unwrap()[0].track_ids, order);
    fs::write(&file, b"{broken").unwrap();
    assert!(add_playlist_tracks("p", &[]).is_err());
    assert!(reorder_playlist("p", &[]).is_err());
    assert_eq!(fs::read(&file).unwrap(), b"{broken");
}
#[test]
fn deletion_cleans_file_and_playlist_and_invalid_index_preserves_data() {
    let scope = Scope::new();
    let source = scope.midi();
    let entry = import_midi(&source).unwrap();
    write_playlists(&[Playlist {
        id: "p".into(),
        name: "p".into(),
        track_ids: vec![entry.id.clone()],
        created_at: "".into(),
    }])
    .unwrap();
    let lists = scope.dir.path().join("playlists.json");
    let saved = fs::read(&lists).unwrap();
    fs::write(&lists, b"invalid").unwrap();
    assert!(delete_midi(&entry.id).is_err());
    assert!(midi_path(&entry.file).unwrap().exists());
    assert_eq!(read_library().unwrap().len(), 1);
    fs::write(&lists, saved).unwrap();
    delete_midi(&entry.id).unwrap();
    assert!(!midi_path(&entry.file).unwrap().exists());
    assert!(read_library().unwrap().is_empty());
    assert!(read_playlists().unwrap()[0].track_ids.is_empty());
}
