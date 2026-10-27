# Security policy

jank.js runs entirely in the browser. It has no server, account, telemetry or upload service. The parts that handle untrusted input are the recording parser (`parseRecording`) and the recording viewer, which opens recording files and accepts a recording from the window that opened it.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue. Include the affected version, the browser and operating system, and steps to reproduce; a recording that triggers the problem helps.

## Supported versions

Fixes are made in the latest 0.x release.
