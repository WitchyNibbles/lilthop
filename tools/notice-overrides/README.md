# Licence texts kept for crates that ship none

These 24 crates have no licence file inside the published crate, so `npm run notices` would list them by SPDX name only. Each file here is a word-for-word copy of the licence file in the crate's upstream repository, read-only, at the commit the published crate was built from (the `git.sha1` in the crate's own `.cargo_vcs_info.json`, which matches the release tag where one exists). The generator uses a folder here only for a crate with no licence file of its own.

When a crate in this list changes version, check its upstream again and update the folder and the table.

| Crate                  | Version | File               | Source (repository, commit)                                                                                   |
| ---------------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| alloc-stdlib           | 0.3.0   | LICENSE            | https://github.com/dropbox/rust-alloc-no-stdlib/blob/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE         |
| block2                 | 0.6.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| dasp_sample            | 0.11.0  | LICENSE-APACHE     | https://github.com/rustaudio/sample/blob/97c3bb9b2363c0b46ac1633858bf1054fd02a980/LICENSE-APACHE              |
| dasp_sample            | 0.11.0  | LICENSE-MIT        | https://github.com/rustaudio/sample/blob/97c3bb9b2363c0b46ac1633858bf1054fd02a980/LICENSE-MIT                 |
| dispatch2              | 0.3.1   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| dispatch2              | 0.3.1   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| dispatch2              | 0.3.1   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| dlopen2                | 0.8.2   | LICENSE            | https://github.com/OpenByteDev/dlopen2/blob/cc80e4a0a90d499b677fdf7743699b4b3a43a989/LICENSE                  |
| dlopen2_derive         | 0.4.3   | LICENSE            | https://github.com/OpenByteDev/dlopen2/blob/cc80e4a0a90d499b677fdf7743699b4b3a43a989/LICENSE                  |
| libappindicator-sys    | 0.9.0   | LICENSE-APACHE     | https://github.com/tauri-apps/libappindicator-rs/blob/eafd1e3682a1247f595410266091e9684021cb6f/LICENSE-APACHE |
| libappindicator-sys    | 0.9.0   | LICENSE-MIT        | https://github.com/tauri-apps/libappindicator-rs/blob/eafd1e3682a1247f595410266091e9684021cb6f/LICENSE-MIT    |
| objc2                  | 0.6.5   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-app-kit          | 0.3.2   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-app-kit          | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-app-kit          | 0.3.2   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| objc2-core-foundation  | 0.3.2   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-core-foundation  | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-core-foundation  | 0.3.2   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| objc2-core-graphics    | 0.3.2   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-core-graphics    | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-core-graphics    | 0.3.2   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| objc2-encode           | 4.1.0   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-exception-helper | 0.1.1   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-exception-helper | 0.1.1   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-exception-helper | 0.1.1   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| objc2-foundation       | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-io-surface       | 0.3.2   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-io-surface       | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-io-surface       | 0.3.2   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| objc2-quartz-core      | 0.3.2   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-quartz-core      | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-quartz-core      | 0.3.2   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| objc2-web-kit          | 0.3.2   | LICENSE-APACHE.txt | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-APACHE.txt             |
| objc2-web-kit          | 0.3.2   | LICENSE-MIT.txt    | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-MIT.txt                |
| objc2-web-kit          | 0.3.2   | LICENSE-ZLIB.txt   | https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE-ZLIB.txt               |
| symphonia              | 0.5.5   | LICENSE            | https://github.com/pdeljanov/Symphonia/blob/6d533f26150953a882a6a111ebd13f0abf7129d5/LICENSE                  |
| symphonia-bundle-mp3   | 0.5.5   | LICENSE            | https://github.com/pdeljanov/Symphonia/blob/6d533f26150953a882a6a111ebd13f0abf7129d5/LICENSE                  |
| symphonia-core         | 0.5.5   | LICENSE            | https://github.com/pdeljanov/Symphonia/blob/6d533f26150953a882a6a111ebd13f0abf7129d5/LICENSE                  |
| symphonia-metadata     | 0.5.5   | LICENSE            | https://github.com/pdeljanov/Symphonia/blob/6d533f26150953a882a6a111ebd13f0abf7129d5/LICENSE                  |
| webview2-com           | 0.39.1  | LICENSE            | https://github.com/wravery/webview2-rs/blob/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE                  |
| webview2-com-macros    | 0.8.1   | LICENSE            | https://github.com/wravery/webview2-rs/blob/dffa41a8a46d3f5565eefbff2de57d38d399f158/LICENSE                  |
| webview2-com-sys       | 0.39.1  | LICENSE            | https://github.com/wravery/webview2-rs/blob/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE                  |

## Notes

- The `objc2` family (objc2, block2, dispatch2, objc2-*): at the published commits (and at the release tags) the repository only has an overview file, `LICENSE.md`, which points to the licence texts but does not hold them. The texts `LICENSE-MIT.txt`, `LICENSE-APACHE.txt` and `LICENSE-ZLIB.txt` were added to the repository later, so they come from the default branch at commit 8a5abacd90d5403fc0463459a35826f892b9142e. Their copyright line says 2026, as upstream has it now. The overview is not copied: the repository's formatter check would rewrite it. objc2, block2, objc2-foundation and objc2-encode are MIT only; the others are Zlib, Apache-2.0 or MIT, at your option. The overview also says the crates are derived from Apple SDKs, see https://github.com/madsmtm/objc2/blob/8a5abacd90d5403fc0463459a35826f892b9142e/LICENSE.md.
- libappindicator-sys has no `repository` in its metadata. Its `.cargo_vcs_info.json` names commit eafd1e3682a1247f595410266091e9684021cb6f, which exists in tauri-apps/libappindicator-rs (path `sys`).
- webview2-com, webview2-com-sys and webview2-com-macros: the licence of the Rust bindings only. The WebView2 loader library inside webview2-com-sys has Microsoft's own licence, which is in `tools/noticeText.mjs`.
- selectors 0.38.0 is not here: its repository (servo/stylo) has no licence file at that commit or on its default branch. It stays listed by SPDX name (MPL-2.0).
