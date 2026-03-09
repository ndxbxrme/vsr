'use strict'

angular.module 'vsProperty'
.factory 'alert', ->
  log: (msg) ->
    humane.log msg