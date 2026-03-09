fs = require 'fs'
path = require 'path'
mime = require 'mime'
crypto = require 'crypto'
zlib = require 'zlib'
async = require 'async'
base64 = require 'base64-stream'
mkdirp = require 'mkdirp'

module.exports = (ndx) ->
  algorithm = ndx.settings.ENCRYPTION_ALGORITHM or 'aes-256-ctr'
  doencrypt = !ndx.settings.DO_NOT_ENCRYPT
  dozip = !ndx.settings.DO_NOT_ENCRYPT
  saveFile = (file) ->
    new Promise (resolve, reject) ->
      if file
        file.type = mime.lookup file.path
        filename = ndx.generateID(12) + path.extname(file.originalFilename)
        outpath = path.join('uploads', filename)
        encrypt = crypto.createCipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
        gzip = zlib.createGzip()
        rs = fs.createReadStream file.path
        st = null
        if dozip
          st = rs.pipe gzip
        if doencrypt
          if st
            st = st.pipe encrypt
          else
            st = rs.pipe encrypt
        if not st
          st = rs
        ws = null
        ws = fs.createWriteStream outpath
        st.pipe ws
        ws.on 'error', (err) ->
          console.log 'write error', err
          reject()
        done = ->
          fs.unlinkSync file.path
          outobj =
            filename: filename
            path: outpath.replace(/\\/g, '/')
            originalFilename: file.originalFilename
            type: file.type
            basetype: file.type.replace /\/.*/, ''
            size: file.size
            date: new Date().valueOf()
            ext: path.extname(file.originalFilename).replace /^\./, ''
          resolve outobj
        ws.on 'finish', ->
          done()
      else
        reject()
  getReadStream = (path) ->
    new Promise (resolve, reject) ->
      decrypt = crypto.createDecipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
      gunzip = zlib.createGunzip()
      sendFileToRes = ->
        st = fs.createReadStream path
        if doencrypt
          st = st.pipe decrypt
        if dozip
          st = st.pipe gunzip
        resolve st
        st.on 'error', (e) ->
          reject e
        decrypt.on 'error', (e) ->
          reject e
        gunzip.on 'error', (e) ->
          reject e
      fs.exists path, (fileExists) ->
        if fileExists
          sendFileToRes()
        else
          reject()
  moveToAttachments = (file) ->
    new Promise (resolve, reject) ->
      getReadStream file.path
      .then (st) ->
        folder = Math.floor(Math.random() * 99999999).toString(36)
        outPath = path.join './attachments/' + folder
        mkdirp outPath, (err) ->
          outPath = path.join outPath, file.originalFilename
          ws = fs.createWriteStream outPath
          st.pipe ws
          ws.on 'finish', ->
            resolve outPath
  ndx.fileTools = 
    saveFile: saveFile
    getReadStream: getReadStream
    moveToAttachments: moveToAttachments