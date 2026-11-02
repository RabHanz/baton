# Vault

An encrypted place for API keys, passwords, recovery codes and small private notes. The assistant can use a secret without ever seeing it.

## Start

Open the **Vault** page and choose a passphrase (8 or more characters). You are shown a **recovery key once**: save it as a file or print it, and keep it off this computer. If you lose both the passphrase and the recovery key, the vault cannot be opened, by design.

## Good to know

- **Unlock** with the passphrase, the recovery key, or Windows Hello. Showing or copying a secret asks Windows Hello again where it is set up.
- The assistant can type a secret into a field, put it on the clipboard for 10 seconds, or hand it to one command. You are asked first unless you allowed that site for a few minutes. Passwords for banks and cards are never filled in for you.
- It locks after ten idle minutes, when the screen locks, and when the computer sleeps. The window shows locked at once and hides any value on show.
- Secrets never go to the History, memory or a log. The Activity list shows what was used and where, never the value.
- **Export** gives an encrypted file protected by its own passphrase.
