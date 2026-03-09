'use strict'

superagent = require 'superagent'
debugInfo = {}
module.exports = (ndx) ->
  apiUrl = process.env.API_URL or ndx.settings.API_URL
  apiKey = process.env.API_KEY or ndx.settings.API_KEY
  fetchProperties = (pageNo, cb) ->
    debugInfo.noInserted = 0
    debugInfo.url = "#{apiUrl}search?APIKey=#{apiKey}"
    debugInfo.time = new Date()
    console.log "fetching from #{apiUrl}search"
    superagent.post "#{apiUrl}search?APIKey=#{apiKey}"
    .set('Rezi-Api-Version', '1.0')
    .send
      MarketingFlags: 'ApprovedForMarketingWebsite'
      MinimumPrice: 0
      MaximumPrice: 9999999
      MinimumBedrooms: 0
      SortBy: 0
      PageSize: 2000
      IncludeStc: true
      BranchIdList: []
      PageNumber: pageNo
    .end (err, response) ->
      debugInfo.err = err
      if not err and response.body.Collection
        console.log 'GOT RESPONSE', err
        for property in response.body.Collection
          property.stc = property.RoleStatus.SystemName is 'OfferAccepted'
          property.NoRooms = 0
          if property.RoomCountsDescription
            if property.RoomCountsDescription.Bedrooms then property.NoRooms += property.RoomCountsDescription.Bedrooms
            if property.RoomCountsDescription.Bathrooms then property.NoRooms += property.RoomCountsDescription.Bathrooms
            if property.RoomCountsDescription.Receptions then property.NoRooms += property.RoomCountsDescription.Receptions
            if property.RoomCountsDescription.Others then property.NoRooms += property.RoomCountsDescription.Others
          property.SearchField = "#{property.Address.Street}|#{property.Address.Town}|#{property.Address.Locality}|#{property.Address.Postcode}|#{property.Address.County}"
          property.displayAddress = "#{property.Address.Number} #{property.Address.Street }, #{property.Address.Locality }, #{property.Address.Town}, #{property.Address.Postcode}"
          ndx.database.exec 'INSERT INTO tmpprops VALUES ?', [property], true
          debugInfo.noInserted++
          if property.RoleId is 25598419
            debugInfo.prop = property.RoleStatus
        if response.body.CurrentCount < response.body.PageSize
          return cb?()
        else
          return fetchProperties pageNo + 1, cb 
      else
        return cb? err
    return
  doFetchProperties = ->
    new Promise (res) ->
      fetchProperties 1, ->
        tables = ndx.database.getDb() 
        if tables.tmpprops.data.length
          tables.props.data = tables.tmpprops.data
        tables.tmpprops.data = []
        res()
  #setInterval doFetchProperties, 5 * 60 * 1000
  #doFetchProperties()
  webhookCalls = 0
  ndx.app.post '/webhook', (req, res, next) ->
    console.log 'WEBHOOK CALLED'
    webhookCalls++
    doFetchProperties()
    .then (res) ->
      superagent.post(process.env.VS_AGENCY_WEBHOOK).end()
      superagent.post(process.env.VS_LETTINGS_WEBHOOK).end()
    res.end 'ok'
  ndx.app.get '/status', (req, res, next) ->
    res.json
      webhookCalls: webhookCalls
      debugInfo: debugInfo