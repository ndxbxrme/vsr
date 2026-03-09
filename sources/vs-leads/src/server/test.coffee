'use strict'

https = require 'https'
fs = require 'fs'
async = require 'async'

period = 72
dateToString = (date, template) ->
  console.log 3
  pad = (num) ->
    if num < 10 then '0' + num else num
  template.replace /([a-z]+)/gi, (all, bit) ->
    switch bit
      when 'dd'
        pad date.getDate()
      when 'MM'
        pad date.getMonth() + 1
      when 'yyyy'
        date.getFullYear()
      when 'hh'
        pad date.getHours()
      when 'mm'
        pad date.getMinutes()
      when 'ss'
        '00'
rightmove = ->
  paths = [
    'getbranchemails'
    #'getbranchphoneleads'
  ]
  doIt = (path, callback) ->
    console.log 'DOING IT', period
    console.log 1
    endDate = new Date()
    startDate = new Date(endDate.valueOf() - (period * 60 * 60 * 1000))
    template = 'dd-MM-yyyy hh:mm:ss'
    console.log 2
    body = JSON.stringify
      "network":
        "network_id": +process.env.RM_NETWORK_ID
      "branch":
        "branch_id": +process.env.RM_BRANCH_ID
      export_period:
        start_date_time: dateToString startDate, template
        end_date_time: dateToString endDate, template
    console.log 'making opts'
    options =
      hostname: process.env.RM_HOST
      path: "/v1/property/#{path}"
      port: 443
      method: 'POST'
      key: fs.readFileSync 'certs/rightmove.key'
      cert: fs.readFileSync 'certs/rightmove.crt'
      passphrase: process.env.RM_SSL_PASS
      headers:
        "Content-Type": "application/json"
        "Content-Length": Buffer.byteLength body
    console.log 'made em', options
    req = https.request options, (res) ->
      console.log 'got res'
      output = ''
      res.on 'data', (data) ->
        console.log 'data'
        output += data.toString('utf8')
      res.on 'end', ->
        console.log 'end'
        data =
          success: false
        try
          data = JSON.parse output
        catch e
          console.log 'error', e
          false
        if data.success
          things = data.emails or data.phone_calls
          if things
            callback()
        else
          period = 72
          callback()
    req.end body
  fetch: ->
    async.eachSeries paths, (path, callback) ->
      doIt path, callback
    , ->
      switch period
        when 72
          period = 1
        when 1
          period = 0.3
rightmove().fetch()