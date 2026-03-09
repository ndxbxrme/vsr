'use strict'

angular.module 'vsProperty'
.factory 'dezrez', ($http, $timeout, env) ->
  console.log 'env', env
  loading =
    selling: false
    letting: false
    viewings: false
    offers: false
  properties = []
  offers = []
  getProperty = (id, address) ->
    for property in properties
      if +property.id is +id
        return property
    newProp = 
      id: id
      type: ''
      details: {}
      viewings: []
      offers: []
      Address: address
    fetchPropertyDetails newProp
    fetchConveyancingDetails newProp
    properties.push newProp
    newProp
  fetchConveyancingDetails = (property) ->
    $http
      method: 'GET'
      url: "#{env.CONVEYANCING_URL}/properties/#{property.id}"
      headers:
        Authorization: "Bearer #{env.CONVEYANCING_TOKEN}"
    .then (response) ->
      if response.data and not response.data.error
        property.progressions = response.data.progressions
        property.purchaser = response.data.purchaser
        property.vendor = response.data.vendor
        property.offer = response.data.offer
        property.modifiedAt = response.data.modifiedAt
    , ->
      true
  fetchPropertyDetails = (property) ->
    property.loading = true
    $http.get '/api/property/' + property.id
    .then (response) ->
      property.loading = false
      if response.data and not response.data.error
        property.details = response.data
        property.Address = property.Address or property.details.Address
        property.error = false
        property.loadingEvents = true
        property.loadingRightmove = true
        $http.get "/api/dezrez/property/#{property.id}/mailouts"
        .then (response) ->
          property.mailouts = 0
          if response.data
            property.mailouts = response.data
          property.loadingEvents = false
        , ->
          property.loadingEvents = false
        $http.get "/api/dezrez/portals/#{property.id}"
        .then (response) ->
          if response.data
            property.portals = response.data
          property.loadingRightmove = false
        , ->
          property.loadingRightmove = false
      else
        property.error = true
    , ->
      property.loading = false
      property.error = true
  fetchViewings = ->
    if not loading.viewings
      loading.viewings = true
      $http.get '/api/dezrez/role/viewings'
      .then (response) ->
        loading.viewings = false
        if response.data and not response.data.error
          openIds = []
          for property in properties
            for viewing in property.viewings
              if viewing.open then openIds.push viewing.Id
            property.viewings = []
          for viewing in response.data
            viewing.date = new Date(viewing.StartDate).valueOf()
            viewing.AccompaniedBy = []
            for group in viewing.AttendingGroups
              if group.Type.Name isnt 'Owner'
                if group.Group?.Grade
                  viewing.Grade = group.Group.Grade
                for person in group.AttendingPeople
                  if not viewing.MainContact
                    viewing.MainContact =
                      name: person.ContactName
                      email: person.PrimaryEmail
                      sortname: person.LastName + person.FirstName
                  else
                    hasPerson = false
                    for p in viewing.AccompaniedBy
                      if p.name is person.ContactName
                        hasPerson = true
                    if not hasPerson
                      viewing.AccompaniedBy.push 
                        name: person.ContactName
                        email: person.PrimaryEmail
            if openIds.indexOf(viewing.Id) isnt -1
              viewing.open = true
            prop = getProperty viewing.MarketingRoleId
            prop.viewings.push viewing
      , ->
        loading.viewings = false
  fetchOffers = ->
    if not loading.offers
      loading.offers = true
      $http.get '/api/dezrez/role/offers'
      .then (response) ->
        if response.data and not response.data.error
          offers = []
          for property in properties
            property.offers = []
          for offer in response.data
            offer.date = new Date(offer.DateTime).valueOf()
            prop = getProperty offer.MarketingRoleId
            offer.prop = prop
            prop.offers.push offer
            offers.push offer
          loading.offers = false
      , ->
        loading.offers = false
  refresh = ->
    loading.selling = true
    properties = []
    $http.get '/api/dezrez/property/list/selling'
    .then (response) ->
      loading.selling = false
      if response.data and not response.data.error
        for property in response.data.Collection
          prop = getProperty property.Id, property.Address
          prop.type = 'selling'
      $http.get '/api/dezrez/property/list/letting'
      .then (response) ->
        loading.letting = false
        if response.data and not response.data.error
          for property in response.data.Collection
            prop = getProperty property.Id, property.Address
            prop.type = 'letting'
        
        $timeout ->
          userProps = []
          for prop in properties
            if prop.details isnt 'no property found'
              myprop = objtrans prop,
                id: true
                address: (property) ->
                  "#{property.Address.Number} #{property.Address.Street }, #{property.Address.Locality }, #{property.Address.Town}"
                image: 'details.Images[0].Url'
              userProps.push myprop
          $http.post '/api/dezrez/update-user-props', properties:userProps
          .then (response) ->
            true
          , ->
            true
        , 1000
      , ->
        loading.letting = false
    , ->
      loading.selling = false
    fetchViewings()
    fetchOffers()
  getProperties: ->
    properties
  getProperty: (id) ->
    getProperty id
  getOffers: ->
    offers
  fetchViewings: fetchViewings
  fetchOffers: fetchOffers
  refresh: refresh
  loading: (type) ->
    if type is 'properties'
      return loading.selling or loading.letting
    if type is 'all'
      return loading.selling or loading.letting or loading.viewings or loading.offers
    loading[type]