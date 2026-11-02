# Security policy

Report a vulnerability in Tessaya privately through this repository's **Security** tab, **Report a vulnerability** (GitHub private vulnerability reporting). Please do not open a public issue or post details until it is fixed. If that button is not available, open an issue that says only "I need a private way to report a security problem" and nothing else, and a private channel will be arranged.

Please include what you did, what you expected and what happened, the version (Settings, About), and your system.

## What counts

Reports about the Tessaya layer are in scope, in particular: the vault (secrets readable or usable without consent, weak unlock, values in logs), the phone page at `/tessaya` and the server's auth scopes, anything that lets content read from the web or a file act as an instruction, the pairing and relay paths, and installers or updates that run unexpected code.

Problems in upstream T3 Code that Tessaya has not changed belong with upstream: see [T3 Code's policy](https://t3.codes/security-policy).

## What to expect

Reports are read as soon as they can be. A fix goes out in a release and is noted in the CHANGELOG once it is safe to describe. Good-faith research that avoids other people's data and keeps to your own installation is welcome.

## Known limits, stated

- Release builds are unsigned for now.
- The vault's Windows Hello check is a gate the app enforces; the passphrase and recovery key are the cryptographic protection (`docs/baton/VAULT.md`).
