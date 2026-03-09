https = require 'https'
putError = (system, e) ->
  console.log e
putError1 = (system, e) ->
  data = JSON.stringify
    id: Math.floor(Math.random() * 99999999).toString(36)
    system: system
    message: e.toString() + '\n' + (e.stack or '').toString()
    date: new Date().toISOString()
  req = https.request
    hostname: 'duit36qa26.execute-api.eu-west-1.amazonaws.com'
    port: 443
    path: '/Prod/error'
    method: 'put'
    headers: 
      'Content-Type': 'application/json'
      'Content-Length': data.length
  req.write data
  req.end()
module.exports = putError