//! Windows names a process by its version resource: the microphone-in-use flyout, Task Manager and the
//! privacy page say "Tessaya voice" instead of the file name. Written here as a .res file the MSVC linker
//! takes directly, so the build needs no rc.exe and no extra crate.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !(windows && msvc) {
        return;
    }
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
    let res = out.join("tessaya-voice.res");
    std::fs::write(&res, version_res(env!("CARGO_PKG_VERSION"))).expect("write the .res file");
    println!("cargo:rustc-link-arg-bins={}", res.display());
}

const STRINGS: [(&str, &str); 5] = [
    ("CompanyName", "Tessaya"),
    ("FileDescription", "Tessaya voice"),
    ("InternalName", "tessaya-voice"),
    ("OriginalFilename", "tessaya-voice.exe"),
    ("ProductName", "Tessaya"),
];

fn version_res(version: &str) -> Vec<u8> {
    let mut parts = version.split(['.', '-']).map(|p| p.parse::<u32>().unwrap_or(0));
    let (major, minor, patch) = (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    );
    let (ms, ls) = ((major << 16) | minor, patch << 16);
    // VS_FIXEDFILEINFO: signature, struct version, file and product versions, flags mask, flags,
    // VOS_NT_WINDOWS32, VFT_APP, subtype, date.
    let fixed_fields: [u32; 13] = [
        0xFEEF_04BD,
        0x0001_0000,
        ms,
        ls,
        ms,
        ls,
        0x3F,
        0,
        0x0004_0004,
        1,
        0,
        0,
        0,
    ];
    let fixed: Vec<u8> = fixed_fields.iter().flat_map(|v| v.to_le_bytes()).collect();
    let mut strings: Vec<Vec<u8>> = STRINGS
        .iter()
        .map(|(key, value)| node(key, true, &wide(value), &[]))
        .collect();
    strings.push(node("FileVersion", true, &wide(version), &[]));
    strings.push(node("ProductVersion", true, &wide(version), &[]));
    // US English, Unicode: the table name and the translation say the same thing.
    let table = node("040904B0", true, &[], &strings);
    let string_info = node("StringFileInfo", true, &[], &[table]);
    let translation = node("Translation", false, &0x04B0_0409u32.to_le_bytes(), &[]);
    let var_info = node("VarFileInfo", true, &[], &[translation]);
    let info = node("VS_VERSION_INFO", false, &fixed, &[string_info, var_info]);
    let mut res = entry(0, 0, 0, &[]);
    // RT_VERSION, id 1, MOVEABLE | PURE, en-US.
    res.extend(entry(16, 0x0030, 0x0409, &info));
    res
}

fn pad(bytes: &mut Vec<u8>) {
    while bytes.len() % 4 != 0 {
        bytes.push(0);
    }
}

fn wide(text: &str) -> Vec<u8> {
    text.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect()
}

/// One version-info block: length, value length (in characters for text), type, key, value, children.
fn node(key: &str, text: bool, value: &[u8], children: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = vec![0; 6];
    bytes.extend(wide(key));
    pad(&mut bytes);
    bytes.extend(value);
    for child in children {
        pad(&mut bytes);
        bytes.extend(child);
    }
    let value_len = if text { value.len() / 2 } else { value.len() };
    let len = bytes.len() as u16;
    bytes[0..2].copy_from_slice(&len.to_le_bytes());
    bytes[2..4].copy_from_slice(&(value_len as u16).to_le_bytes());
    bytes[4..6].copy_from_slice(&u16::from(text).to_le_bytes());
    bytes
}

/// A .res resource header (numeric type, name 1) and its data; the empty first entry marks a 32-bit .res.
fn entry(kind: u16, flags: u16, language: u16, data: &[u8]) -> Vec<u8> {
    let name: u16 = if kind == 0 { 0 } else { 1 };
    let mut bytes = Vec::new();
    bytes.extend((data.len() as u32).to_le_bytes());
    bytes.extend(32u32.to_le_bytes());
    bytes.extend([0xFF, 0xFF]);
    bytes.extend(kind.to_le_bytes());
    bytes.extend([0xFF, 0xFF]);
    bytes.extend(name.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(flags.to_le_bytes());
    bytes.extend(language.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(data);
    pad(&mut bytes);
    bytes
}
