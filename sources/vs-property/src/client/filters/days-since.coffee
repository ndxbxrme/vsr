'use strict'

angular.module 'vsProperty'
.filter 'daysSince', ->
  (date) ->
    if date
      oldDate = new Date date
      noDays = Math.floor((new Date().valueOf() - oldDate.valueOf()) / (24 * 60 * 60 * 1000))
      "#{noDays} #{if noDays is 1 then 'day' else 'days'}"