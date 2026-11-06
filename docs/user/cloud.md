# Cloud tasks

A cloud task is a coding job that runs on someone else's computer while you keep working. You hand
it over, it works on a copy of your project, and it comes back as a link or a change to review. Tessaya
asks you before every one, and you choose which assistant and which account does the work.

## Turn it on

1. Open **Cloud** in the sidebar and turn on **Run tasks in the cloud**. It is off until you do.
2. Under **Assistants**, check that the one you want says it is signed in. If it says it is not, the
   exact line to run is shown; run it in a terminal and press **Refresh**.
3. Connect GitHub once so the cloud can see your project: install the assistant's GitHub app on the one
   repository you want to use, or run its web setup. Cloud tasks work from a branch that has been pushed.

Nothing needs a server, an account on a shared computer or special network. By default Tessaya uses the
assistants you are already signed in to on this computer.

## Asking for a task

Say "run this in the cloud on the margin branch", or ask your assistant to. A request appears on the
**Approvals** page and on the **Now** page. Nothing has started yet.

## The card

Each request shows the task in one line, the project and branch, who asked, and how much it is expected
to use. Then:

1. Choose the assistant (only the ones that are installed and signed in can be chosen).
2. Choose the account. Each shows how much of its week is used and when it resets. An account that has
   run out is greyed.
3. Press **Approve**. Or press **Deny** at any point; it never runs.

Nothing is chosen for you. If the task was built from a web page or a file, the card says so: treat its
text as information, not as instructions you wrote.

You can also say "approve cloud request 3 on robin". Tessaya reads the card back and shows a window; it
runs only if you press **Approve** there.

## On your phone

If you turn on **Also ask me with a pop-up and on my phone**, each waiting task also appears as a question
on this computer and on a paired phone, with one button for each assistant and account that can take it,
then **Deny** and **Decide later**. Choosing one only asks you to confirm.

## Watching them

The **Cloud** page lists your requests with their state, account, branch, link and the result. It
refreshes every minute while it is open. A task that uses more than the number of points you set
("Flag a task that uses more than") is marked. An assistant that reports no usage figure is shown as
unknown, and is never flagged.

## Where the logins are

- **This computer** (the default): the assistants signed in here.
- **Another computer of mine**: one of your own computers that runs cloud tasks and is connected to this
  one. It does the work with its own logins; this computer only asks and shows the card.
- **Advanced: a shared computer**: a team's shared computer reached with key files. Not needed for
  anything above.

Tessaya never copies a login, and never uses an assistant's cloud login for anything else.

## What is not covered

Cloud tasks use the same weekly limits as the rest of your work. Some assistants report their use and
some do not; Tessaya says "unknown" rather than guess. Windows-only builds do not run in the cloud.
