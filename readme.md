# GSync

A GUI based web app that lets you sync local directory on your system to a remote directory on Google Drive.

## Installation

Download or clone the repository and
Use the package manager [npm](https://www.npmjs.com/get-npm) to install dependencies.

```bash
npm install
```

## Usage

Change the redirect_uri index to 0.
Run only on port 5000.

```node.js
const CLIENT_ID = OAuth2Data.web.client_id;
const CLIENT_SECRET = OAuth2Data.web.client_secret;
const REDIRECT_URL = OAuth2Data.web.redirect_uris[0];
```
