'use strict'

angular.module 'vsProperty'
.factory 'auth', ($http, $q, $timeout, $location, dezrez) ->
  user = null
  potentialUsers = []
  loading = false
  getDezrezPromise = (defer, needsDezrez, email) ->
    if not potentialUsers.length and not checkRoles(['superadmin', 'admin'])
      loading = true
      if user.dezrez and user.dezrez.Id
        loading = false
        defer.resolve user
      else
        $http
          method: 'POST'
          url: '/api/dezrez/email'
          data:
            email:email or user.email
        .then (data) ->
          loading = false
          if data.data and data.data.length and data.data isnt 'error'
            if data.data.length is 1
              user.dezrez = data.data[0]
            else
              potentialUsers = data.data
          if needsDezrez and not user.dezrez
            defer.reject {}
          else
            defer.resolve user
        , ->
          loading = false
          if needsDezrez and not user.dezrez
            defer.reject {}
          else
            defer.resolve user
    else
      loading = false
      defer.reject {}
  getUserPromise = (needsDezrez) ->
    loading = true
    defer = $q.defer()
    if user
      getDezrezPromise defer, needsDezrez
    else
      $http.post '/api/refresh-login'
      .then (data) ->
        if data and data.data isnt 'error'
          user = data.data
          getDezrezPromise defer, needsDezrez
          if user.dezrez and user.dezrez.Id and not dezrez.loading('all')
            dezrez.refresh()
        else 
          loading = false
          user = null
          defer.reject {}
      , ->
        loading = false
        user = null
        defer.reject {}
    defer.promise
  hasRole = (role) ->
    getKey = (root, key) ->
      root[key]
    keys = role.split /\./g
    allgood = false
    if user.roles
      root = user.roles
      for key in keys
        root = getKey root, key
        if root
          allgood = true
        else
          allgood = false
          break
    allgood
  checkRoles = (role, isAnd) ->
    rolesToCheck = []
    getRole = (role) ->
      type = Object.prototype.toString.call role
      if type is '[object Array]'
        for r in role
          getRole r
      else if type is '[object Function]'
        r = role req
        getRole r
      else if type is '[object String]'
        if rolesToCheck.indexOf(role) is -1
          rolesToCheck.push role
    getRole role
    truth = if isAnd then true else false
    for r in rolesToCheck
      if isAnd
        truth = truth and hasRole(r)
      else
        truth = truth or hasRole(r)
    truth
    
  getPromise: (needsDezrez) ->
    defer = $q.defer()
    getUserPromise needsDezrez
    .then ->
      defer.resolve user
    , ->
      if window.location.href.contains 'unsubscribe'
        defer.resolve user
      else
        defer.reject {}
        $location.path '/'
    defer.promise
  getDezrezPromise: (email) ->
    defer = $q.defer()
    getDezrezPromise defer, true, email
    defer.promise
  checkRoles: (role) ->
    if user
      checkRoles role
  getUser: ->
    user
  getDezrezUser: ->
    if user and user.dezrez and user.dezrez.Id then user else null
  getPotentialUsers: ->
    potentialUsers
  clearPotentialUsers: ->
    potentialUsers = []
  loading: ->
    loading