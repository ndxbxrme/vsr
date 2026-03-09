(function() {
  'use strict';
  var e, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }

  module.factory('Sorter', function() {
    return {
      create: function(opts) {
        if (Object.prototype.toString.call(opts.sort) === '[object Object]') {
          return {
            set: function(field) {
              var firstKey, i, key, outobj;
              firstKey = Object.keys(opts.sort)[0];
              outobj = {};
              if (firstKey !== field) {
                outobj[field] = 1;
              } else {
                outobj[firstKey] = opts.sort[firstKey] === 1 ? -1 : 1;
              }
              i = 0;
              for (key in opts.sort) {
                if (i++ > 0) {
                  outobj[key] = opts.sort[key];
                }
              }
              return opts.sort = outobj;
            },
            setLocal: function(field) {
              return true;
            },
            class: function(field) {
              var firstKey;
              firstKey = Object.keys(opts.sort)[0];
              return {
                "has-sort": true,
                sorting: firstKey === field,
                desc: opts.sort[firstKey] !== 1
              };
            }
          };
        } else {
          return {
            set: function(field) {
              if (opts.sort !== field) {
                opts.sort = field;
                return opts.sortDir = 'ASC';
              } else {
                if (opts.sortDir === 'DESC') {
                  return opts.sortDir = 'ASC';
                } else {
                  return opts.sortDir = 'DESC';
                }
              }
            },
            setLocal: function(field) {
              if (!opts.sort) {
                opts.sort = '';
              }
              if (opts.sort.indexOf(field) === -1) {
                opts.sort = field;
                return opts.sortDir = 'ASC';
              } else {
                if (opts.sort.indexOf('-') === 0) {
                  opts.sort = field;
                  return opts.sortDir = 'ASC';
                } else {
                  opts.sort = '-' + field;
                  return opts.sortDir = 'DESC';
                }
              }
            },
            class: function(field) {
              var ref;
              return {
                "has-sort": true,
                sorting: (-1 < (ref = opts.sort.indexOf(field)) && ref < 2),
                desc: opts.sortDir === 'DESC'
              };
            }
          };
        }
      }
    };
  });

}).call(this);

//# sourceMappingURL=index.js.map
