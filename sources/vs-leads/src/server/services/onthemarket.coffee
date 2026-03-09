'use strict'

https = require 'https'
superagent = require 'superagent'
fs = require 'fs'
async = require 'async'
objtrans = require 'objtrans'

module.exports = (ndx) ->
  period = 72
  dateToString = (date, template) ->
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
  templates =
    getbranchemails:
      date: (input) ->
        if input and input.email_date
          date = new Date()
          input.email_date.replace /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/, (all, dd, MM, yyyy, hh, mm, ss) ->
            date = new Date("#{yyyy}-#{MM}-#{dd} #{hh}:#{mm}:#{ss}")
          return date.valueOf()
      uid: (input) ->
        'rm' + input.email_id
      email: 'from_address'
      user: 'user.user_contact_details'
      comments: 'user.user_information.comments'
      roleId: true
      propertyId: true
      onthemarketId: 'property.onthemarket_id'
      "property": (input) ->
        if input and input.prop
          address: "#{input.prop.Address.Number or input.prop.Address.BuildingName} #{input.prop.Address.Street}"
          address2: "#{input.prop.Address.Locality}"
          town: input.prop.Address.Town
          county: input.prop.Address.County
          postcode: input.prop.Address.Postcode        
      roleType: true
      price: true
      source: ->
        'onthemarket'
      method: ->
        'email'
    getbranchphoneleads:
      date: 'call_date'
  onthemarket = ->
    paths = [
      'getbranchemails'
      #'getbranchphoneleads'
    ]
    doIt = (path, callback) ->
      #console.log 'DOING IT', period
      endDate = new Date()
      startDate = new Date(endDate.valueOf() - (period * 60 * 60 * 1000))
      template = 'dd-MM-yyyy hh:mm:ss'
      body = JSON.stringify
        "network":
          "network_id": +process.env.OTM_NETWORK_ID
        "branch":
          "branch_id": +process.env.OTM_BRANCH_ID
        export_period:
          start_date_time: dateToString startDate, template
          end_date_time: dateToString endDate, template
      options =
        hostname: process.env.OTM_HOST
        path: "/v1/property/#{path}"
        port: 443
        method: 'POST'
        key: fs.readFileSync 'certs/onthemarket.pem'
        cert: fs.readFileSync 'certs/onthemarket.pem'
        headers:
          "Content-Type": "application/json"
          "Content-Length": Buffer.byteLength body
      insertLead = (lead, cb) ->
        ndx.database.select 'leads',
          uid: lead.uid
        , (leads) ->
          if leads and leads.length
            cb()
          else
            ndx.database.insert 'leads', lead
            cb()
        , true
      req = https.request options, (res) ->
        output = ''
        res.on 'data', (data) ->
          output += data.toString('utf8')
        res.on 'end', ->
          data =
            success: false
          try
            data = JSON.parse output
          catch e
            #console.log 'error', e
            false
          if data.success
            things = data.emails or data.phone_calls
            if things
              async.each things, (item, itemCallback) ->
                if item.date
                  item.date = new Date(item.date).valueOf()
                if item.property?.agent_ref
                  ndx.dezrez.get 'role/{id}', null, id:item.property.agent_ref, (err, body) ->
                    if not err and body
                      item.roleType = body.RoleType?.SystemName or 'Selling'
                      item.roleId = +item.property.agent_ref
                      item.propertyId = body.PropertyId
                      item.price = body.Price?.PriceValue
                      ndx.dezrez.get 'property/{id}', null, id:body.PropertyId, (err, body) ->
                        item.property.prop = body
                        insertLead objtrans(item, templates[path]), itemCallback
                else
                  item.roleType = 'Valuation'
                  insertLead objtrans(item, templates[path]), itemCallback
              , callback
          else
            period = 72
            callback()
      req.end body
    fetch: ->
      try
        async.eachSeries paths, (path, callback) ->
          doIt path, callback
        , ->
          switch period
            when 72
              period = 1
            when 1
              period = 0.3
      catch e
        console.log 'onthemarket error', e
  ndx.onthemarket = onthemarket()
  ndx.database.on 'ready', ->
    setInterval ndx.onthemarket.fetch, 5 * 60 * 1000
    ndx.onthemarket.fetch() 