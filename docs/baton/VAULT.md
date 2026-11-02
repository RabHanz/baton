# The vault: keeping secrets safely instead of refusing them (D151)

The Director's words: "There should be a vault/passkey and a safer encrypted way to store secrets and private things rather
than refusing outright!" Until now the memory door (`refuseToStore`, MEMORY.md section 3) only said no. The vault gives
those things a place, and gives the assistant a way to use them without ever seeing them.

## 1. Threat model

Protected against: a stolen or copied disk, a backup or sync that carries the files, a curious process reading the state
folder, logs and history, and above all **the model**: a secret value must never enter a prompt, a tool result, the
conversation file, memory, History, a thread or a log.

Not protected against: malware running as him while the vault is unlocked (it can read process memory and the clipboard),
and a keylogger when he types the passphrase. The vault is locked by default and re-locks quickly to shrink that window.
It is not a replacement for a hardware key or a bank's own protections.

## 2. What goes in

API keys and tokens, passwords, recovery codes, private notes, small files (up to 256 KB), personal IDs, and financial
credentials (banks, cards, payment). Each item has a name, a label, a category (`login`, `key`, `note`, `id`, `file`,
`financial`), the secret value, and a policy (section 5). Names and labels are encrypted with the values: a locked vault
reveals nothing, not even how many items it holds beyond the file size.

## 3. Storage

One file, `vault.json`, in the state folder of the machine that owns the vault (the laptop's desktop app). Servers see
ciphertext only, and only if sync is switched on for the vault file; nothing else reads it.

- Items are one JSON document encrypted with **AES-256-GCM** under a random 256-bit **vault key**, a fresh 12-byte IV on
  every write, the format version as additional data.
- The vault key is stored wrapped three ways; any one opens it:
  1. **Passphrase.** A key-encryption key from **scrypt** (N=2^17, r=8, p=1, 16-byte random salt) wraps the vault key
     with AES-256-GCM. (Argon2id is not in Node's crypto; scrypt is memory-hard and needs no dependency. The parameters
     are in the file, so they can be raised later.)
  2. **Recovery key.** 256 random bits shown once as grouped base32 for him to print or save. It wraps the vault key the
     same way. Losing both the passphrase and the recovery key loses the vault, by design.
  3. **This Windows account.** `safeStorage` (Windows DPAPI) wraps the vault key for this user on this machine. Used for
     "unlock with Windows Hello" (below). Never the only way in.
- **Passkey.** WebAuthn with a platform authenticator would let Windows Hello itself guard the key. Electron's
  `BrowserWindow` does not expose Windows Hello to `navigator.credentials` reliably, so Tessaya does not rely on it. The
  fallback is the one above: a passphrase for the cryptography, plus a Windows Hello consent prompt
  (`UserConsentVerifier`, through a small PowerShell call) before the DPAPI-wrapped key is used, and before any reveal, copy or assistant use (after his yes). Where Hello is not set up, the unlocked vault is the proof.
  **The limit, stated plainly:** the Hello prompt is a gate the app enforces, not a cryptographic secret; the passphrase and
  the recovery key are the cryptographic protection. A passkey can replace the gate when Electron supports it.
- **Auto-lock** after ten idle minutes (adjustable) and when the screen locks or the machine sleeps. Locking zeroes the
  in-memory key, closes any value on show, clears the clipboard if Tessaya put something there, and redraws the Vault tab at once, idle locks included.
- **Recovery key at creation:** shown once with Save as a file (a save dialog, so he can put it on a USB stick) and Print.
- **Export and import** is the vault file re-wrapped under an export passphrase; import asks for it and merges by name.
- No plaintext is ever written to a log, History, memory, the conversation file or a thread. The audit log records the
  name, purpose, target, outcome and time of every use, never the value.

## 4. What the assistant may do

The assistant never receives a value. Its tools:

- `vault_list`: names, labels, categories and policies only.
- `vault_use(name, purpose, target, how)`: Tessaya injects the value into the action itself, then says what happened.
  `how` is `type` (into the focused field), `paste` (to the clipboard, cleared after 10 seconds) or `env` (an environment
  variable for one command it runs; the command's output is scrubbed). Filling a field in his Chrome is `type` after the
  assistant has focused the field.
- `vault_save_pending(name, category)`: after the offer in section 6, files the secret it was just told about, without
  sending the value through the model again.

Approval: before a use the window shows the secret's **name**, the **purpose** and the **target** (application or domain),
never the value. The default answer is no; a spoken yes or the Windows Hello prompt is a yes. A tool result, a command
output and a screen read are **scrubbed**: the value, and its common encodings (base64, URL, JSON-escaped), are replaced
by `[vault:name]` before the model sees them.

**Taint.** A request for a secret that came from text inside a web page, file or message is data, not an instruction: it
always asks, whatever the secret's policy says (D127).

## 5. Per-secret policy

- `ask`: ask every time (default).
- `domain`: after one approval, allowed for the same target for N minutes (default 10), then asks again.
- `never`: the assistant cannot use it; he can view and copy it himself.
- `self`: set automatically for `financial` items and not changeable: the assistant never injects them; he types them
  himself. Money movement stays refused (D127) whatever the vault holds.

## 6. The refusal becomes an offer

Wherever a secret meets a tool (`memory_remember`, a dictated sentence, a note), the reply is no longer a bare refusal. It
says "That looks like a secret. Want it in the vault?" and keeps the text only in the desktop process, not in the
conversation. A yes calls `vault_save_pending`; the value goes to the vault and nowhere else. If the vault is locked it asks
him to unlock first. The never-store filter also runs on dictation History: a dictated password is saved as "[redacted:
looks like a secret]" with the same offer, never as plain text.

## 7. What is never done

No value in any prompt, log, History, memory, thread, crash report or sync other than as ciphertext. No secret read aloud.
No injection of a `financial` or `never` item. No use without approval unless a `domain` window is open and nothing in the
turn is tainted. No vault key ever leaves the process unencrypted. No secret in the repository or in a test (tests use
obviously fake values).

## 8. Order of work

1. This note. 2. Crypto, store and service (desktop). 3. Tools, gate, scrubbing, the offer and the History redaction.
2. The Vault tab and the lock button.
