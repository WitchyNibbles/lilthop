//! `cargo run --example analyze -- recording.wav`
//!
//! Prints the median f0, the share of voiced frames and f0 per second, so a
//! real voice can be checked against a tuner. Reads one file, writes nothing.

use std::path::PathBuf;
use std::process::ExitCode;

use lilthop_lib::analyze::analyze_file;

fn main() -> ExitCode {
    let Some(path) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: cargo run --example analyze -- <file.wav>");
        return ExitCode::from(2);
    };
    match analyze_file(&path) {
        Ok(report) => {
            print!("{report}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{}", e.message());
            ExitCode::FAILURE
        }
    }
}
