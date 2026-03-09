'use strict'
version = require('../../package').version
ObjectID = require 'bson-objectid'
s = require 'underscore.string'

module.exports =
  id: ObjectID.generate()
  generateID: ->
    ObjectID.generate()
  extend: (dest, source) ->
    #Object.assign dest, source
    if not dest
      dest = {}
    if not source
      source = {}
    for i of source
      if source.hasOwnProperty(i)
        if dest.hasOwnProperty(i) and Object.prototype.toString.call(dest[i]) is '[object Object]'
          @extend dest[i], source[i]
        else
          dest[i] = source[i]
  fillTemplate: (template, data) -> 
    template.replace /\{\{(.+?)\}\}/g, (all, match) ->
      evalInContext = (str, context) ->
        (new Function("with(this) {return #{str}}"))
        .call context
      evalInContext match, data
  startTime: new Date().valueOf()
  transforms: {}
  logo: "       _                                \n ___ _| |_ _    ___ ___ ___ _ _ ___ ___ \n|   | . |_'_|  |_ -| -_|  _| | | -_|  _|\n|_|_|___|_,_|  |___|___|_|  \\_/|___|_|  \n                                        \n"
  version: version
  cookieName: 'token'
  vars: {}