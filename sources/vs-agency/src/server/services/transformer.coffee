'use strict'

objtrans = require 'objtrans'

module.exports = (ndx) ->
  transform = (args, cb) ->
    if args.transformer and mytransform = transforms[args.transformer]
      mytransform._id = true
      for obj, i in args.objs
        args.objs[i] = objtrans obj, mytransform
    cb true
  setImmediate ->
    ndx.database.on 'selectTransform', transform
    
  transforms =
    "dashboard/properties":
      "override": true
      "progressions": true
      "displayAddress": (obj) ->
        "#{obj.offer.Property.Address.Number} #{obj.offer.Property.Address.Street }, #{obj.offer.Property.Address.Locality }, #{obj.offer.Property.Address.Town}, #{obj.offer.Property.Address.Postcode}"
      "milestoneIndex": true
      "role": true
      "roleId": true
      "purchasersSolicitor": true
      "vendorsSolicitor": true
      "pipeline": true
      "consultant": true