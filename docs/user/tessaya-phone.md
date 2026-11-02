# Tessaya on your phone

A page on your own server that works in the phone's browser and installs to the home screen. No app store.

## Start

1. Pair the phone with your server the normal way (see [Remote access](./remote-access.md)), over Tailscale or the tunnel.
2. On the phone open `/tessaya` on your server's address. Use the browser's Add to Home Screen.

## What it does

- **Needs me**, **Approvals** (Approve or Deny shows the exact action), **Now**, **Jobs** (Stop, Retry), **Weave**.
- A text box and a **Talk** button: hold, speak, release. What you say goes to the assistant on your computer, which answers as if you had typed it there; the reply appears on the phone (Asked tab). Talk needs a speech model on the server; if there is none it says so and you can type.
- If your computer is off or Tessaya is not open on it, the phone says so and your ask waits (up to a day) for it to come back.
- When your computer asks you something (a plan to run, a screen capture), it also shows up under Approvals on the phone with the same words. Answer on either; the first answer counts.
- A count on the tab and the home-screen icon, refreshed every 20 seconds while the page is open. There are no push notifications.

## Good to know

- A phone paired for viewing only can look but not act; pair it with operate access to approve or stop.
- Secrets in the Vault never go to the phone.
- Not tried on a real phone yet.
