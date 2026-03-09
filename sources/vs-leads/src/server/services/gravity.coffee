'use strict'

crypto = require 'crypto-js'
http = require 'http'
superagent = require 'superagent'
async = require 'async'
objtrans = require 'objtrans'

module.exports = (ndx) ->
  templates =
    sellingLetting:
      date: true
      uid: (input) ->
        'gv26:' + input.id
      email: '2'
      user: (input) ->
        title: input['5']
        last_name: input['1']
        phone_day: input['3']
      comments: '6'
      roleId: '13'
      rightmoveId: 'roleId'
      "property": (input) ->
        address: input['15']
        address2: input['16']
        town: input['17']
        county: input['18']
        postcode: input['20']        
      roleType: '11'
      price: '14'
      lengthOfTenancy: '24.6'
      source: ->
        'gravity'
      method: ->
        'web'
    newTenancyApplication:
      date: true
      uid: (input) ->
        'gv24:' + input.id
      propertyId: '105'
      email: '61'
      roleId: '113'
      address: '114'
      image: '115'
      price: '116'
      lengthOfTenancy: '6'
      comments: '12'
      applicant: (input) ->
        {
          title: input['2.2']
          first_name: input['2.3']
          last_name: input['2.6']
          phone_no: input['77']
          email: input['61']
          dob: input['95']
          living_status: input['56']
          employment_status: input['51']
          company_name: input['100']
          occupation: input['117']
          time_employed: input['83']
          salary: input['101']
          proof_of_identity: input['57']
          address:
            street: input['71.1']
            address2: input['71.2']
            town: input['71.3']
            postcode: input['71.5']
          preferences:
            smokes: input['74.1']
            renting_agent: input['74.2']
            pets: input['74.3']
            renting_landlord: input['74.4']
            children: input['74.5']
            arrears: input['74.6']
        }
      applicant2: (input) ->
        {
          title: input['31.2']
          first_name: input['31.3']
          last_name: input['31.6']
          phone_no: input['80']
          email: input['85']
          dob: input['98']
          living_status: input['68']
          employment_status: input['62']
          company_name: input['87']
          occupation: input['86']
          time_employed: input['88']
          salary: input['103']
          proof_of_identity: input['47']
          address:
            street: input['3.1']
            address2: input['3.2']
            town: input['3.3']
            postcode: input['3.5']
          preferences:
            smokes: input['75.1']
            renting_agent: input['75.2']
            pets: input['75.3']
            renting_landlord: input['75.4']
            children: input['75.5']
            arrears: input['75.6']
        }
      rent_details: (input) ->
        {
          monthly_rent: input['9']
          tenancy_start: input['99']
        }
      consent: '107.2'
      source: ->
        'gravity'
      method: ->
        'web'
    valuation:
      date: true
      uid: (input) ->
        'gv16:' + input.id
      email: '3'
      user: (input) ->
        title: input['1.2']
        first_name: input['1.3']
        last_name: input['1.6']
        phone_day: input['4']
      comments: (input) ->
        'Property Type: ' + input['16']  + '\n'
        'Bedrooms: ' + input['18']  + '\n'
        'Bathrooms: ' + input['20']  + '\n'
        'Receptions: ' + input['19']  + '\n'
        'Other Info: ' + input['12']  + '\n'
        'Preferred date 1: ' + input['22'] + ' @ ' + input['44']  + '\n'
        'Preferred date 2: ' + input['25'] + ' @ ' + input['26']  + '\n'
        'Comments: ' + input['27']  + '\n'
      property: (input) ->
        address: input['15.1']
        address2: input['15.2']
        town: input['15.3']
        county: input['15.4']
        postcode: input['15.5']
      roleType: ->
        'Valuation'
      source: ->
        'gravity'
      method: ->
        'web'
    offer:
      date: 'date_created'
      uid: (input) ->
        'gv31:' + input.id
      email: '4'
      telephone: '5'
      applicant: (input) ->
        input['2.2'] + ' ' + input['2.3'] + ' ' + input['2.6']
      applicant2: (input) ->
        return '' if not input['31.2']
        (input['31.2'] + ' ' + input['31.3'] + ' ' + input['31.6']).trim()
      applicantAddress: (input) ->
        input['3.1'] + ', ' + input['3.2'] + ', ' + input['3.3'] + ', ' + input['3.5']
      propertyId: '49'
      offerAmount: '9'
      movingPosition: '6'
      financialPosition: '7'
      hasConveyancer: '17'
      conveyancerCompany: '33'
      conveyancerName: '34'
      conveyancerPhone: '36'
      conveyancerEmail: '38'
      conveyancerAddress: (input) ->
        input['35.1'] + ', ' + input['35.2'] + ', ' + input['35.3'] + ', ' + input['35.5']
      comments: '12'
      roleId: (input) ->
        ((input['59'] or '').match(/role_id" value="([^"]+)"/) or [null, ''])[1]
      address: (input) ->
        ((input['59'] or '').match(/prop_address" value="([^"]+)"/) or [null, ''])[1]
      image: (input) ->
        ((input['59'] or '').match(/prop_image" value="([^"]+)"/) or [null, ''])[1]
      price: (input) ->
        ((input['59'] or '').match(/prop_price" value="([^"]+)"/) or [null, ''])[1]
      uploads: (input) ->
        Object.keys(input).map (key) ->
          val = input[key]
          if val and val.toString().includes('uploads/gravity_forms')
            return
              key: key,
              file: val
          null
        .filter (file) -> file
    instruction:
      date: 'date_created'
      uid: (input) ->
        'gv41' + input.id
      address: '3'
      vendorName: (input) ->
        (input['4'] + ' ' + input['5'])
      email: '8'
      user: '14'
      askingPrice: '10'
      fee: '11'
      instructedOn: 'date_created'
      
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

  insertInstruction = (instruction, cb) ->
    ndx.database.select 'instructions',
      uid: instruction.uid
    , (instructions) ->
      if instructions and instructions.length
        cb()
      else
        ndx.database.insert 'instructions', instruction
        cb()
    , true
      
  insertOffer = (offer, cb) ->
    ndx.database.select 'offers',
      uid: offer.uid
    , (offers) ->
      if offers and offers.length
        cb()
      else
        if offer.roleId
          console.log 'inserting offer', offer.roleId
          ndx.database.insert 'offers', offer
          #send email
          ndx.database.selectOne 'emailtemplates', name: 'New Offer'
          .then (template) ->
            return if not template
            template.offer = offer
            template.to = 'sales@vitalspace.co.uk'
            ndx.email.send template
        cb()
    , true
  insertLettingsOffer = (offer, cb) ->
    ndx.database.select 'offerslettings',
      uid: offer.uid
      deleted: null
    , (offers) ->
      if offers and offers.length
        console.log 'offers length', offers.length
        cb()
      else
        if offer.roleId
          console.log 'inserting', offer
          ndx.database.insert 'offerslettings', offer
          #send email
          ndx.database.selectOne 'emailtemplates', name: 'New Lettings Offer'
          .then (template) ->
            return if not template
            template.offer = offer
            template.to = 'lettings@vitalspace.co.uk'
            ndx.email.send template
        cb()
    , true
  
  
  CalculateSig = (stringToSign, privateKey) ->
    hash = crypto.HmacSHA1 stringToSign, privateKey
    base64 = hash.toString(crypto.enc.Base64)
    encodeURIComponent base64
  doGravity = (formNo, gravityCb) ->
    console.log 'starting gravity', formNo
    try
      d = new Date()
      expiration = 3600
      unixtime = parseInt(d.getTime() / 1000)
      future_unixtime = unixtime + expiration
      publicKey = process.env.GRAVITY_PUBLIC_KEY.trim()
      privateKey = process.env.GRAVITY_PRIVATE_KEY.trim()
      method = "GET"
      route = "forms/#{formNo}/entries"
      stringToSign = publicKey + ":" + method + ":" + route + ":" + future_unixtime
      sig = CalculateSig stringToSign, privateKey
      console.log "contacting gravity"
      superagent.get "https://vitalspace.co.uk/gravityformsapi/forms/#{formNo}/entries?api_key=#{publicKey}&signature=#{sig}&expires=#{future_unixtime}"
      .end (err, res) ->
        console.log 'error', err
        if err
          #console.log 'error', err
          gravityCb()
        else
          #console.log 'response', res.body.response
        if res.body.response and res.body.response.entries
          async.each res.body.response.entries, (item, itemCallback) ->
            item.date = new Date(item.date_created).valueOf()
            #item.roleType = item['11']
            if formNo is 26
              insertLead objtrans(item, templates.sellingLetting), itemCallback
            else if formNo is 24
              insertLettingsOffer objtrans(item, templates.newTenancyApplication), itemCallback
            else if formNo is 16
              insertLead objtrans(item, templates.valuation), itemCallback
            else if formNo is 41
              insertInstruction objtrans(item, templates.instruction), itemCallback
            else if formNo is 31
              if item['59']
                insertOffer objtrans(item, templates.offer), itemCallback
              else
                console.log 'no offer'
                itemCallback()
            else
              console.log 'item callback'
              itemCallback()
          , ->
            console.log 'gravity cb'
            gravityCb()
        else
          console.log 'gravity cb 2'
          gravityCb()
    catch e
      console.log 'gravity error'
  ndx.gravity =
    fetch: ->
      doGravity 26, ->
        doGravity 16, ->
          doGravity 31, ->
            doGravity 24, ->
              doGravity 41, ->
        #console.log 'gravity done'
  ndx.database.on 'ready', ->
    #ndx.database.delete 'offers'
    setInterval ndx.gravity.fetch, 5 * 60 * 1000
    ndx.gravity.fetch()