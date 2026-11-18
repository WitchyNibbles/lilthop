//! Tauri's GTK stack on Linux pins glib 0.18, whose string array reader is
//! unsound (RUSTSEC-2024-0429): it asks GLib to write the string's pointer
//! into a local that Rust treats as immutable, so an optimised build can go on
//! reading the pointer as null. `vendor/glib` is glib 0.18.5 with upstream's
//! fix, applied through `[patch.crates-io]` in Cargo.toml.
#![cfg(target_os = "linux")]

use glib::prelude::*;

#[test]
fn every_string_in_a_string_array_reads_back() {
    let words = ["low", "high"].to_variant();
    let read: Vec<&str> = words.array_iter_str().unwrap().collect();
    assert_eq!(read, ["low", "high"]);
}
