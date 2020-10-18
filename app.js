const fs = require("fs");
const express = require("express");
const chokidar = require("chokidar");
const bodyParser = require("body-parser");
const OAuth2Data = require("./credentials.json");

// =======
var path = require("path");
var crypto = require("crypto");

var remoteFolderPath;
var localFolderPath;

const FOLDER_MIME = "application/vnd.google-apps.folder";
// const remoteFolderPath = "dev2/test4";
// const localFolderPath = "C:/tmp/drive123";
// ============
var name, pic, drive;

const { google } = require("googleapis");

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

const CLIENT_ID = OAuth2Data.web.client_id;
const CLIENT_SECRET = OAuth2Data.web.client_secret;
const REDIRECT_URL = OAuth2Data.web.redirect_uris[1];

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URL
);
var authed = false;

// If modifying these scopes, delete token.json.
const SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile";

app.set("view engine", "ejs");

app.get("/", (req, res) => {
  if (!authed) {
    // Generate an OAuth URL and redirect there
    var url = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES
    });
    // console.log(url);
    res.render("index", { url: url });
  } else {
    var oauth2 = google.oauth2({
      auth: oAuth2Client,
      version: "v2"
    });
    oauth2.userinfo.get(function (err, response) {
      if (err) {
        // console.log(err);
      } else {
        // console.log(response.data);
        name = response.data.name;
        pic = response.data.picture;
        res.render("success", {
          name: response.data.name,
          pic: response.data.picture
        });
      }
    });
  }
});

app.post("/sync", (req, res) => {
  // console.log(`local path ${req.body.localpath}`);
  // console.log(`remote path ${req.body.remotepath}`);
  localFolderPath = req.body.localpath;
  remoteFolderPath = req.body.remotepath;
  res.render("sync", {
    success: true
  });
  chokidar.watch(localFolderPath).on("all", (event, path) => {
    console.log(event);
    syncFolder();
  });
});
app.get("/stop", (req, res) => {
  chokidar
    .watch(localFolderPath)
    .close()
    .then(() => res.redirect("/logout"));
});

app.get("/logout", (req, res) => {
  authed = false;
  res.redirect("/");
});

app.get("/google/callback", function (req, res) {
  const code = req.query.code;
  if (code) {
    // Get an access token based on our OAuth code
    oAuth2Client.getToken(code, function (err, tokens) {
      if (err) {
        // console.log("Error authenticating");
        // console.log(err);
      } else {
        // console.log("Successfully authenticated");
        // console.log(tokens);
        oAuth2Client.setCredentials(tokens);

        authed = true;
        res.redirect("/");
      }
    });
  }
});

// ==========================================

function syncFolder() {
  createRemoteBaseHierarchy("root", function (folderId) {
    syncLocalFolderWithRemoteFolderId(localFolderPath, folderId);
  });
}

function createRemoteBaseHierarchy(parentId, callback) {
  var folderSegments = remoteFolderPath.split("/");

  var createSingleRemoteFolder = function (parentId) {
    var remoteFolderName = folderSegments.shift();
    drive = google.drive({ version: "v2", auth: oAuth2Client });
    if (remoteFolderName === undefined)
      // done processing folder segments - start the folder syncing job
      callback(parentId);
    else {
      var query =
        "(mimeType='" +
        FOLDER_MIME +
        "') and (trashed=false) and (title='" +
        remoteFolderName +
        "') and ('" +
        parentId +
        "' in parents)";
      // console.log(query);

      drive.files.list(
        {
          maxResults: 1,
          q: query
        },
        function (err, response) {
          if (err) {
            // console.log(query);
            // console.log("The API returned an error 1: " + err);
            return;
          }

          if (response.data.items.length === 1 || response.items.length === 1) {
            // folder segment already exists, keep going down...

            var folderId = response.data.items[0].id;
            createSingleRemoteFolder(folderId);
          } else {
            // folder segment does not exist, create the remote folder and keep going down...
            drive.files.insert(
              {
                resource: {
                  title: remoteFolderName,
                  parents: [{ id: parentId }],
                  mimeType: FOLDER_MIME
                }
              },
              function (err, response) {
                if (err) {
                  // console.log("The API returned an error 2: " + err);
                  return;
                }

                var folderId = response.id;
                // console.log("+ /%s", remoteFolderName);
                // console.log(response);
                createSingleRemoteFolder(folderId);
              }
            );
          }
        }
      );
    }
  };

  createSingleRemoteFolder(parentId);
}
function syncLocalFolderWithRemoteFolderId(localFolderPath, remoteFolderId) {
  retrieveAllItemsInFolder(remoteFolderId, function (remoteFolderItems) {
    processRemoteItemList(localFolderPath, remoteFolderId, remoteFolderItems);
  });
}
function retrieveAllItemsInFolder(remoteFolderId, callback) {
  var query = "(trashed=false) and ('" + remoteFolderId + "' in parents)";

  var retrieveSinglePageOfItems = function (items, nextPageToken) {
    var params = { q: query };
    if (nextPageToken) params.pageToken = nextPageToken;

    drive.files.list(params, function (err, response) {
      if (err) {
        invokeLater(err, function () {
          retrieveAllItemsInFolder(remoteFolderId, callback);
        });

        return;
      }

      items = items.concat(response.data.items);
      var nextPageToken = response.nextPageToken;

      if (nextPageToken) retrieveSinglePageOfItems(items, nextPageToken);
      else {
        // console.log(items);
        callback(items);
      }
    });
  };

  retrieveSinglePageOfItems([]);
}
function processRemoteItemList(
  localFolderPath,
  remoteFolderId,
  remoteFolderItems
) {
  var remoteItemsToRemoveByIndex = [];
  for (var i = 0; i < remoteFolderItems.length; i++)
    remoteItemsToRemoveByIndex.push(i);

  // lists files and folders in localFolderPath
  fs.readdirSync(localFolderPath).forEach(function (localItemName) {
    var localItemFullPath = path.join(localFolderPath, localItemName);
    var stat = fs.statSync(localItemFullPath);

    // console.log(localItemName);
    var buffer;
    var buffer2;
    if (stat.isFile())
      // if local item is a file, puts its contents in a buffer
      buffer = fs.readFileSync(localItemFullPath);
    // buffer2 = fs.createReadStream(localItemFullPath);

    var remoteItemExists = false;

    for (var i = 0; i < remoteFolderItems.length; i++) {
      var remoteItem = remoteFolderItems[i];

      if (remoteItem.title === localItemName) {
        // local item already in the remote item list
        if (stat.isDirectory())
          // synchronizes sub-folders
          syncLocalFolderWithRemoteFolderId(localItemFullPath, remoteItem.id);
        // following function will compare md5Checksum
        // and will update the file contents if hash is different
        else updateSingleFileIfNeeded(buffer, remoteItem, localItemFullPath);

        remoteItemExists = true;

        // item is in both local and remote folders, remove its index from the array
        remoteItemsToRemoveByIndex = remoteItemsToRemoveByIndex.filter(
          function (val) {
            return val != i;
          }
        );
        break;
      }
    }

    if (!remoteItemExists)
      // local item not found in remoteFolderItems, create the item (file or folder)
      createRemoteItemAndKeepGoingDownIfNeeded(
        localItemFullPath,
        buffer,
        remoteFolderId,
        stat.isDirectory()
      );
  });

  // removes remoteItems that are not in the local folder (ie not accessed previously)
  remoteItemsToRemoveByIndex.forEach(function (index) {
    var remoteItem = remoteFolderItems[index];
    deleteSingleItem(remoteItem);
  });
}

function updateSingleFileIfNeeded(buffer, remoteItem, localItemFullPath) {
  var md5sum = crypto.createHash("md5");
  md5sum.update(buffer);
  var fileHash = md5sum.digest("hex");

  if (remoteItem.md5Checksum === fileHash)
    console.log("= %s", remoteItem.title);
  else {
    // file already there, but different hash, upload new content!
    drive.files.update(
      {
        fileId: remoteItem.id,
        media: { body: fs.createReadStream(localItemFullPath) }
      },
      function (err, response) {
        if (err) {
          invokeLater(err, function () {
            updateSingleFileIfNeeded(buffer, remoteItem);
          });

          return;
        }

        // console.log("^ %s", remoteItem.title);
      }
    );
  }
}

function createRemoteItemAndKeepGoingDownIfNeeded(
  localItemFullPath,
  buffer,
  remoteFolderId,
  isDirectory
) {
  var localItemName = path.basename(localItemFullPath);

  if (isDirectory && localItemName == ".svn") return;

  var itemToInsert = {
    resource: {
      title: localItemName,
      parents: [{ id: remoteFolderId }]
    }
  };

  // console.log("item ti insert " + itemToInsert);
  if (isDirectory) itemToInsert.resource.mimeType = FOLDER_MIME;
  else itemToInsert.media = { body: fs.createReadStream(localItemFullPath) };

  drive.files.insert(itemToInsert, function (err, response) {
    if (err) {
      invokeLater(err, function () {
        // console.log(err);
        createRemoteItemAndKeepGoingDownIfNeeded(
          localItemFullPath,
          buffer,
          remoteFolderId,
          isDirectory
        );
      });
      return;
    }

    // console.log("+ %s%s", isDirectory ? "/" : "", localItemName);

    if (isDirectory)
      syncLocalFolderWithRemoteFolderId(localItemFullPath, response.id);
  });
}
function deleteSingleItem(remoteItem) {
  drive.files.delete(
    {
      fileId: remoteItem.id
    },
    function (err, response) {
      if (err) {
        invokeLater(err, function () {
          deleteSingleItem(remoteItem);
        });

        return;
      }

      // console.log("- %s", remoteItem.title);
    }
  );
}

function invokeLater(err, method) {
  var rand = Math.round(Math.random() * 5000);
  //console.log('The API returned an error: ' + err + ' - retrying in ' + rand + 'ms');
  setTimeout(function () {
    method();
  }, rand);
}

// ======================================================

app.listen(process.env.PORT || 5000, () => {
  console.log("App is listening on Port 5000");
});
