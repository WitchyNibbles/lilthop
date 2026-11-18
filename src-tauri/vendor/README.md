# Vendored crates

## glib 0.18.5

Tauri's GTK stack on Linux depends on glib 0.18, which has an unsound string array reader ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)). The fix shipped in glib 0.20 and gtk-rs publishes no more 0.18 releases, so `Cargo.toml` patches glib with this copy.

It is the crate as published on crates.io (sha256 `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`, the checksum `Cargo.lock` recorded for it) with two changes:

1. Upstream's fix, gtk-rs-core commit [b5a4071](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34), in `src/variant_iter.rs`.
2. `cargo fix --lib -p glib` with rustc 1.99.1. It writes out 31 elided lifetimes and drops the parentheses around three `dyn` types, which changes no behaviour. Cargo prints a path dependency's compiler warnings, which it hides for crates.io ones, and these were the only warnings.

To compare it with the published crate:

```sh
curl -L -o glib-0.18.5.crate https://static.crates.io/crates/glib/glib-0.18.5.crate
sha256sum glib-0.18.5.crate
tar -xzf glib-0.18.5.crate
diff -r glib-0.18.5 src-tauri/vendor/glib
```

`tests/glib_variant.rs` fails if the fix stops applying. Remove this copy and the `[patch.crates-io]` section once `cargo tree -i glib` shows Tauri on glib 0.20 or later.
