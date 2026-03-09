'use strict'

angular.module 'vsProperty', [
  'ngRoute'
  'ui.router'
  'propertyEngine'
  'ui.gravatar'
  'ndx'
  'angular-circular-progress'
]
.config (gravatarServiceProvider, $qProvider) ->
  gravatarServiceProvider.defaults =
    size: 32
    "default": 'mm'
    rating: 'pg'
  console.log '%c', 'font-size:3rem; background:#f15b25 url(https://myproperty.vitalspace.co.uk/public/img/VitalSpaceLogo-2016.svg);background-size:cover;background-repeat:no-repeat;padding-left:18rem;border:0.2rem solid #f15b25;border-radius:0.2rem'
.run ($rootScope, $state, $stateParams, $http, auth) ->
  delete $http.defaults.headers.common.Authorization
  auth.getPromise false
  .then ->
    true
  , ->
    false
  $rootScope.$on '$stateChangeSuccess', ->
    propertyPages = [
      'overview'
      'photos'
      'layout'
      'maps'
      'schools'
      'transport'
      'brochure'
      'taxbands'
    ]
    $rootScope.propertyPage = propertyPages.indexOf($state.current.name) isnt -1
  root = Object.getPrototypeOf $rootScope
  root.sort = ''
  root.setSort = (field) ->
    if @sort.indexOf(field) is -1
      @sort = field
    else
      if @sort.indexOf('-') is 0
        @sort = field
      else
        @sort = '-' + field
  root.getSortClass = (field) ->
    "has-sort": true
    sorting: @sort.indexOf(field) isnt -1
    desc: @sort.indexOf('-') is 0