# Tessaya on your phone

A page on your own server that works in the phone's browser and installs to the home screen. No app store.

## Start

1. Pair the phone with your server the normal way (see [Remote access](./remote-access.md)), over Tailscale or the tunnel.
2. On the phone open `/tessaya` on your server's address. Use the browser's Add to Home Screen.

## What it does

- **Needs me**, **Approvals** (Approve or Deny shows the exact action), **Now**, **Jobs** (Stop, Retry), **Weave**.
- A text box and a **Talk** button: hold, speak, release. Tessaya shows what it heard and answers. Talk needs a speech model on the server; if there is none it says so and you can type.
- A count on the tab and the home-screen icon, refreshed every 20 seconds while the page is open. There are no push notifications.

## Good to know

- A phone paired for viewing only can look but not act; pair it with operate access to approve or stop.
- Secrets in the Vault never go to the phone.
- Not tried on a real phone yet.
