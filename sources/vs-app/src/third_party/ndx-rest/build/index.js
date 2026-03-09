(function() {
  'use strict';
  var e, error, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }

  module.provider('rest', function() {
    var bustCache, cacheBuster, callbacks, disableCache, hash, lockAll, syncCallback, waitForAuth;
    waitForAuth = false;
    bustCache = false;
    lockAll = false;
    disableCache = false;
    cacheBuster = function() {
      if (bustCache) {
        return "?" + (Math.floor(Math.random() * 9999999999999));
      } else {
        return '';
      }
    };
    callbacks = {
      endpoints: []
    };
    syncCallback = function(name, obj, cb) {
      var callback, j, len, ref;
      if (callbacks[name] && callbacks[name].length) {
        ref = callbacks[name];
        for (j = 0, len = ref.length; j < len; j++) {
          callback = ref[j];
          callback(obj);
        }
      }
      return typeof cb === "function" ? cb() : void 0;
    };
    hash = function(str) {
      var h, i;
      h = 5381;
      i = str.length;
      while (i) {
        h = (h * 33) ^ str.charCodeAt(--i);
      }
      return h;
    };
    return {
      bustCache: function(val) {
        return bustCache = val;
      },
      waitForAuth: function(val) {
        return waitForAuth = val;
      },
      disableCache: function(val) {
        return disableCache = val;
      },
      $get: function($http, $injector, $timeout) {
        var addToCache, auth, autoId, cache, callRefreshFns, callSocketRefresh, clearCache, cloneSpecialProps, destroy, endpoints, fetchFromCache, listTransform, loading, maintenanceMode, ndxCheck, needsRefresh, okToLoad, refreshFns, restore, restoreSpecialProps, socket, socketRefresh, startLoading, stopLoading, waiting;
        okToLoad = true;
        endpoints = {};
        autoId = '_id';
        refreshFns = [];
        waiting = false;
        ndxCheck = null;
        needsRefresh = false;
        maintenanceMode = false;
        loading = 0;
        startLoading = function() {
          return loading++;
        };
        stopLoading = function() {
          loading--;
          if (loading < 0) {
            return loading = 0;
          }
        };
        listTransform = {
          items: true,
          total: true,
          page: true,
          pageSize: true,
          error: true
        };
        cache = {};
        addToCache = function(endpoint, args, obj) {
          var h;
          if (!disableCache) {
            h = hash(JSON.stringify(args));
            if (!cache[endpoint]) {
              cache[endpoint] = {};
            }
            return cache[endpoint][h] = JSON.stringify({
              data: obj.data
            });
          }
        };
        fetchFromCache = function(endpoint, args) {
          var h, newvar, str;
          if (!disableCache) {
            h = hash(JSON.stringify(args));
            if (cache[endpoint]) {
              if (cache[endpoint][h]) {
                str = cache[endpoint][h];
                newvar = JSON.parse(str);
                return newvar;
              }
            }
          }
          return null;
        };
        clearCache = function(endpoint) {
          if (endpoint) {
            return delete cache[endpoint];
          } else {
            return cache = {};
          }
        };
        callRefreshFns = function(isSocket) {
          var fn, j, key, len, results;
          if (okToLoad && endpoints) {
            results = [];
            for (key in endpoints) {
              if (endpoints[key].needsRefresh) {
                for (j = 0, len = refreshFns.length; j < len; j++) {
                  fn = refreshFns[j];
                  fn(key, endpoints[key].ids, isSocket);
                }
                endpoints[key].ids = [];
                results.push(endpoints[key].needsRefresh = false);
              } else {
                results.push(void 0);
              }
            }
            return results;
          }
        };
        destroy = function(obj) {
          var item, j, k, key, len, len1, type;
          type = Object.prototype.toString.call(obj);
          if (type === '[object Object]') {
            if (obj.destroy) {
              obj.destroy();
            }
            for (j = 0, len = obj.length; j < len; j++) {
              key = obj[j];
              destroy(obj[key]);
            }
          } else if (type === '[object Array]') {
            for (k = 0, len1 = obj.length; k < len1; k++) {
              item = obj[k];
              destroy(item);
            }
          }
        };
        restore = function(obj) {
          var item, j, k, key, len, len1, type;
          type = Object.prototype.toString.call(obj);
          if (type === '[object Object]') {
            if (obj.refreshFn) {
              refreshFns.push(obj.refreshFn);
            }
            for (j = 0, len = obj.length; j < len; j++) {
              key = obj[j];
              restore(obj[key]);
            }
          } else if (type === '[object Array]') {
            for (k = 0, len1 = obj.length; k < len1; k++) {
              item = obj[k];
              restore(item);
            }
          }
        };
        cloneSpecialProps = function(obj) {
          var clonedItem, item, j, key, len, output, type;
          output = null;
          type = Object.prototype.toString.call(obj);
          if (type === '[object Array]') {
            output = output || [];
            for (j = 0, len = obj.length; j < len; j++) {
              item = obj[j];
              if (item[autoId]) {
                clonedItem = cloneSpecialProps(item);
                clonedItem[autoId] = item[autoId];
                output.push(clonedItem);
              }
            }
          } else if (type === '[object Object]') {
            output = output || {};
            for (key in obj) {
              if (key.indexOf('$') === 0) {
                output[key] = obj[key];
              } else if (Object.prototype.toString.call(obj[key]) === '[object Array]') {
                output[key] = cloneSpecialProps(obj[key]);
              }
            }
          }
          return output;
        };
        restoreSpecialProps = function(obj, clonedProps) {
          var clonedItem, item, j, k, key, len, len1, type;
          type = Object.prototype.toString.call(obj);
          if (type === '[object Array]') {
            for (j = 0, len = obj.length; j < len; j++) {
              item = obj[j];
              for (k = 0, len1 = clonedProps.length; k < len1; k++) {
                clonedItem = clonedProps[k];
                if (item[autoId] === clonedItem[autoId]) {
                  restoreSpecialProps(item, clonedItem);
                  break;
                }
              }
            }
          } else if (type === '[object Object]') {
            for (key in clonedProps) {
              if (key.indexOf('$') === 0 && key !== '$$hashKey') {
                obj[key] = clonedProps[key];
                restore(obj[key]);
              } else {
                restoreSpecialProps(obj[key], clonedProps[key]);
              }
            }
          }
        };
        if ($injector.has('ndxCheck')) {
          ndxCheck = $injector.get('ndxCheck');
        }
        if ($injector.has('Auth')) {
          okToLoad = false;
          auth = $injector.get('Auth');
          auth.onUser(function() {
            return $timeout(function() {
              var endpoint;
              okToLoad = true;
              for (endpoint in endpoints) {
                endpoints[endpoint].needsRefresh = true;
              }
              return callRefreshFns();
            });
          });
        }
        callSocketRefresh = function() {
          var endpoint, hasFuture, key;
          hasFuture = false;
          for (key in endpoints) {
            endpoint = endpoints[key];
            if (endpoint.needsRefresh && endpoint.refreshAt > new Date().valueOf()) {
              hasFuture = true;
            }
          }
          if (hasFuture) {
            return $timeout(callSocketRefresh, 20);
          } else {
            return callRefreshFns(true);
          }
        };
        socketRefresh = function(data) {
          var id, key, type;
          if (!lockAll) {
            if (data) {
              clearCache(data.table);
              endpoints[data.table].needsRefresh = true;
              endpoints[data.table].refreshAt = new Date().valueOf() + 400;
              type = Object.prototype.toString.call(data.id);
              if (type === '[object Array]') {
                for (id in data.id) {
                  endpoints[data.table].ids.push(id);
                }
              } else if (type === '[object String]') {
                endpoints[data.table].ids.push(data.id);
              }
            } else {
              clearCache();
              for (key in endpoints) {
                endpoints[key].needsRefresh = true;
              }
            }
            return callSocketRefresh();
          }
        };
        if ($injector.has('socket')) {
          socket = $injector.get('socket');
          socket.on('connect', function() {
            return socket.emit('rest', {});
          });
          if (!$injector.has('Server')) {
            socket.on('update', socketRefresh);
            socket.on('insert', socketRefresh);
            socket.on('delete', socketRefresh);
          }
        }
        $timeout(function() {
          return $http.get('/rest/endpoints').then(function(response) {
            var endpoint, j, len, ref;
            if (response.data && response.data.endpoints && response.data.endpoints.length) {
              ref = response.data.endpoints;
              for (j = 0, len = ref.length; j < len; j++) {
                endpoint = ref[j];
                endpoints[endpoint] = {
                  needsRefresh: true,
                  lastRefresh: 0,
                  nextRefresh: 0,
                  ids: []
                };
              }
              if (response.data.autoId) {
                autoId = response.data.autoId;
              }
              if (response.data.server) {
                maintenanceMode = response.data.server === 'maintenance';
              }
              if (needsRefresh) {
                callRefreshFns();
              }
              return syncCallback('endpoints', response.data);
            }
          }, function(err) {
            return false;
          });
        });
        return {
          lockAll: function() {
            return lockAll = true;
          },
          unlockAll: function() {
            return lockAll = false;
          },
          on: function(name, callback) {
            return callbacks[name].push(callback);
          },
          off: function(name, callback) {
            return callbacks[name].splice(callbacks[name].indexOf(callback), 1);
          },
          endpoints: endpoints,
          autoId: autoId,
          maintenanceMode: function() {
            return maintenanceMode;
          },
          socketRefresh: socketRefresh,
          needsRefresh: function(val) {
            return needsRefresh = val;
          },
          callRefreshFns: callRefreshFns,
          startLoading: startLoading,
          stopLoading: stopLoading,
          okToLoad: function() {
            return okToLoad;
          },
          save: function(endpoint, obj, cb) {
            startLoading();
            return $http.post((endpoint.route || ("/api/" + endpoint)) + ("/" + (obj[autoId] || '')), obj).then((function(_this) {
              return function(response) {
                stopLoading();
                endpoints[endpoint].needsRefresh = true;
                ndxCheck && ndxCheck.setPristine();
                callRefreshFns(endpoint);
                return response && response.data && (typeof cb === "function" ? cb(response.data) : void 0);
              };
            })(this), function(err) {
              stopLoading();
              return false;
            });
          },
          'delete': function(endpoint, obj, cb) {
            startLoading();
            return $http["delete"]((endpoint.route || ("/api/" + endpoint)) + ("/" + (obj[autoId] || ''))).then((function(_this) {
              return function(response) {
                stopLoading();
                endpoints[endpoint].needsRefresh = true;
                ndxCheck && ndxCheck.setPristine();
                callRefreshFns(endpoint);
                return response && response.data && (typeof cb === "function" ? cb(response.data) : void 0);
              };
            })(this), function(err) {
              stopLoading();
              return false;
            });
          },
          search: function(endpoint, args, obj, cb, isSocket) {
            var handleResponse, response;
            isSocket || startLoading();
            args = args || {};
            handleResponse = function(response) {
              var clonedProps;
              isSocket || stopLoading();
              clonedProps = null;
              if (obj.items && obj.items.length) {
                clonedProps = cloneSpecialProps(obj.items);
              }
              objtrans(response.data, args.transform || listTransform, obj);
              if (obj.items && obj.items.length && clonedProps) {
                restoreSpecialProps(obj.items, clonedProps);
              }
              obj.isSocket = isSocket;
              return typeof cb === "function" ? cb(obj) : void 0;
            };
            if (response = fetchFromCache(endpoint, args)) {
              return $timeout(function() {
                return handleResponse(response);
              });
            } else {
              return $http.post(endpoint.route || ("/api/" + endpoint + "/search" + (cacheBuster())), endpoint.route && args && args.where ? args.where : args).then(function(response) {
                addToCache(endpoint, args, response);
                return handleResponse(response);
              }, function(err) {
                isSocket || stopLoading();
                obj.items = [];
                obj.total = 0;
                obj.page = 1;
                obj.error = err;
                obj.isSocket = isSocket;
                return typeof cb === "function" ? cb(obj) : void 0;
              });
            }
          },
          list: function(endpoint, obj, cb, isSocket) {
            var handleResponse, response;
            isSocket || startLoading();
            handleResponse = function(response) {
              var clonedProps;
              isSocket || stopLoading();
              clonedProps = null;
              if (obj.items && obj.items.length) {
                clonedProps = cloneSpecialProps(obj.items);
              }
              objtrans(response.data, args.transform || listTransform, obj);
              if (obj.items && obj.items.length && clonedProps) {
                restoreSpecialProps(obj.items, clonedProps);
              }
              obj.isSocket = isSocket;
              return typeof cb === "function" ? cb(obj) : void 0;
            };
            if (response = fetchFromCache(endpoint, {})) {
              return $timeout(function() {
                return handleResponse(response);
              });
            } else {
              return $http.post(endpoint.route || ("/api/" + endpoint + (cacheBuster()))).then(function(response) {
                addToCache(endpoint, {}, response);
                return handleResponse(response);
              }, function(err) {
                isSocket || stopLoading();
                obj.items = [];
                obj.total = 0;
                obj.page = 1;
                obj.error = err;
                obj.isSocket = isSocket;
                return typeof cb === "function" ? cb(obj) : void 0;
              });
            }
          },
          single: function(endpoint, id, obj, cb, isSocket) {
            var handleResponse, response;
            isSocket || startLoading();
            handleResponse = function(response) {
              var clonedProps;
              isSocket || stopLoading();
              clonedProps = null;
              if (obj.item) {
                clonedProps = cloneSpecialProps(obj.item);
              }
              obj.item = response.data;
              if (obj.item && clonedProps) {
                restoreSpecialProps(obj.item, clonedProps);
              }
              obj.isSocket = isSocket;
              return typeof cb === "function" ? cb(obj) : void 0;
            };
            if (Object.prototype.toString.call(id) === '[object Object]') {
              id = escape(JSON.stringify(id));
            }
            if (response = fetchFromCache(endpoint, {
              id: id
            })) {
              return $timeout(function() {
                return handleResponse(response);
              });
            } else {
              return $http.get((endpoint.route || ("/api/" + endpoint)) + ("/" + id + (obj.all ? '/all' : '') + (cacheBuster()))).then(function(response) {
                addToCache(endpoint, {
                  id: id
                }, response);
                return handleResponse(response);
              }, function(err) {
                isSocket || stopLoading();
                obj.item = {};
                obj.isSocket = isSocket;
                return typeof cb === "function" ? cb(obj) : void 0;
              });
            }
          },
          register: function(fn) {
            return refreshFns.push(fn);
          },
          dereg: function(fn) {
            return refreshFns.splice(refreshFns.indexOf(fn), 1);
          },
          destroy: destroy,
          loading: function() {
            return loading;
          },
          clearCache: clearCache,
          checkCache: function() {
            return cache;
          }
        };
      }
    };
  }).run(function($rootScope, $http, $timeout, rest) {
    var root, throttle;
    throttle = function(func, wait, options) {
      var args, context, later, previous, result, timeout;
      context = void 0;
      args = void 0;
      result = void 0;
      timeout = null;
      previous = 0;
      if (!options) {
        options = {};
      }
      later = function() {
        previous = options.leading === false ? 0 : Date.now();
        timeout = null;
        result = func.apply(context, args);
        if (!timeout) {
          context = args = null;
        }
      };
      return function() {
        var now, remaining;
        now = Date.now();
        if (!previous && options.leading === false) {
          previous = now;
        }
        remaining = wait - (now - previous);
        context = this;
        args = arguments;
        if (remaining <= 0 || remaining > wait) {
          if (timeout) {
            $timeout.cancel(timeout);
            timeout = null;
          }
          previous = now;
          result = func.apply(context, args);
          if (!timeout) {
            context = args = null;
          }
        } else if (!timeout && options.trailing !== false) {
          timeout = $timeout(later, remaining);
        }
        return result;
      };
    };
    root = Object.getPrototypeOf($rootScope);
    root.restLoading = rest.loading;
    root.list = function(endpoint, args, cb, saveCb, locked) {
      var RefreshFn, dereg, ignoreNextWatch, obj, throttledSearch;
      ignoreNextWatch = false;
      if (args) {
        cb = args.onData || cb;
        saveCb = args.onSave || saveCb;
      }
      obj = {
        items: null,
        args: args,
        refreshFn: null,
        endpoint: endpoint,
        locked: locked,
        save: function(item, checkFn) {
          if (checkFn) {
            return checkFn('save', endpoint, item, function() {
              return rest.save(endpoint, item, saveCb);
            });
          } else {
            return rest.save(endpoint, item, saveCb);
          }
        },
        "delete": function(item, checkFn) {
          if (checkFn) {
            return checkFn('delete', endpoint, item, function() {
              return rest["delete"](endpoint, item);
            });
          } else {
            return rest["delete"](endpoint, item);
          }
        },
        destroy: function() {
          if (typeof dereg === "function") {
            dereg();
          }
          return rest.dereg(obj.refreshFn);
        }
      };
      throttledSearch = throttle(rest.search, 1000);
      RefreshFn = function(endpoint, args) {
        return function(table, blank, isSocket) {
          var ep, j, len, ref, ref1, ref2, results;
          if (args != null ? args.preRefresh : void 0) {
            args.preRefresh(args);
            ignoreNextWatch = true;
          }
          if (!obj.locked) {
            if (obj.items) {
              rest.destroy(obj.items);
            }
            if (endpoint.route) {
              if (endpoint.endpoints && table) {
                ref = endpoint.endpoints;
                results = [];
                for (j = 0, len = ref.length; j < len; j++) {
                  ep = ref[j];
                  if (table === ep) {
                    throttledSearch(endpoint, args, obj, cb, isSocket || ((ref1 = obj.args) != null ? ref1.isSocket : void 0));
                    break;
                  } else {
                    results.push(void 0);
                  }
                }
                return results;
              }
            } else {
              if (table === endpoint || !table) {
                return throttledSearch(endpoint, args, obj, cb, isSocket || ((ref2 = obj.args) != null ? ref2.isSocket : void 0));
              }
            }
          }
        };
      };
      obj.refreshFn = RefreshFn(endpoint, args);
      rest.register(obj.refreshFn);
      if (endpoint.route && !endpoint.endpoints) {
        rest.search(endpoint, args, obj, cb);
      }
      dereg = this.$watch(function() {
        return JSON.stringify(args);
      }, function(n, o) {
        if (!ignoreNextWatch) {
          if (rest.okToLoad()) {

            /*
            if endpoint.route
              if endpoint.endpoints and endpoint.endpoints.length
                for ep in endpoint.endpoints
                  rest.endpoints[ep].needsRefresh = true
            else
              rest.endpoints[endpoint].needsRefresh = true
             */
            return obj.refreshFn(obj.endpoint);
          } else {
            return rest.needsRefresh(true);
          }
        } else {
          return ignoreNextWatch = false;
        }
      }, true);
      this.$on('$destroy', function() {
        return obj.destroy();
      });
      if (!args && rest.endpoints.endpoints) {
        obj.refreshFn(obj.endpoint);
      }
      if (rest.okToLoad()) {
        rest.callRefreshFns();
      }
      return obj;
    };
    return root.single = function(endpoint, id, cb, saveCb, locked, all) {
      var RefreshFn, obj, throttledSingle;
      obj = {
        all: all,
        item: null,
        refreshFn: null,
        endpoint: endpoint,
        locked: locked,
        save: function(checkFn) {
          if (checkFn) {
            return checkFn('save', endpoint, this.item, (function(_this) {
              return function() {
                return rest.save(endpoint, _this.item, saveCb);
              };
            })(this));
          } else {
            return rest.save(endpoint, this.item, saveCb);
          }
        },
        "delete": function(checkFn) {
          if (checkFn) {
            return checkFn('delete', endpoint, this.item, (function(_this) {
              return function() {
                return rest["delete"](endpoint, _this.item);
              };
            })(this));
          } else {
            return rest["delete"](endpoint, this.item);
          }
        },
        destroy: function() {
          return rest.dereg(obj.refreshFn);
        }
      };
      throttledSingle = throttle(rest.single, 1000);
      RefreshFn = function(endpoint, id) {
        return function(table, ids, isSocket) {
          var ep, j, len, ref, results;
          if (ids && obj.item && ids.indexOf(obj.item[rest.autoId]) === -1) {
            return;
          }
          if (!obj.locked) {
            if (endpoint.route) {
              if (endpoint.endpoints) {
                if (endpoint.endpoints.length && table) {
                  ref = endpoint.endpoints;
                  results = [];
                  for (j = 0, len = ref.length; j < len; j++) {
                    ep = ref[j];
                    if (table === ep) {
                      throttledSingle(endpoint, id, obj, cb, isSocket);
                      break;
                    } else {
                      results.push(void 0);
                    }
                  }
                  return results;
                }
              }
            } else {
              if (table === endpoint || !table) {
                return throttledSingle(endpoint, id, obj, cb, isSocket);
              }
            }
          }
        };
      };
      obj.refreshFn = RefreshFn(endpoint, id);
      rest.register(obj.refreshFn);
      if (rest.okToLoad() && rest.endpoints.endpoints) {

        /*
        if endpoint.route
          if endpoint.endpoints
            for ep in endpoint.endpoints
              rest.endpoints[ep].needsRefresh = true
        else
          rest.endpoints[endpoint].needsRefresh = false
         */
        obj.refreshFn(obj.endpoint);
      } else {
        rest.needsRefresh(true);
      }
      rest.single(endpoint, id, obj, cb);
      this.$on('$destroy', obj.destroy);
      return obj;
    };
  });

}).call(this);

//# sourceMappingURL=index.js.map
