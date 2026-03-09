(function () {
  'use strict';
  var e, error, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }

  module.provider('Auth', function () {
    var settings;
    settings = {
      redirect: 'dashboard',
      site: 'main'
    };
    return {
      config: function (args) {
        return angular.extend(settings, args);
      },
      $get: function ($http, $q, $state, $window, $interval, $injector) {
        var checkRoles, current, currentParams, errorRedirect, errorRedirectParams, genId, getUserPromise, hasRole, loading, prev, prevParams, socket, sockets, user, userCallbacks;
        user = null;
        loading = false;
        current = '';
        currentParams = null;
        errorRedirect = '';
        errorRedirectParams = null;
        prev = '';
        prevParams = null;
        userCallbacks = [];
        sockets = false;
        socket = null;
        if (/*false && */$injector.has('socket')) {
          sockets = true;
          const allSockets = $injector.get('socket');
          allSockets.forEach(socket => {
            socket.io.on('connect', function () {
              if (user) {
                return socket.io.emit('user', user);
              }
            });
          })
        }
        genId = function (len) {
          var chars, i, output;
          output = '';
          chars = 'abcdef0123456789';
          output = new Date().valueOf().toString(16);
          i = output.length;
          while (i++ < len) {
            output += chars[Math.floor(Math.random() * chars.length)];
          }
          return output;
        };
        const handleUser = function (data) {
          user = data;
          localStorage.setItem('token', user.local.sites.main.token);
          Object.keys(user.local.sites).forEach(key => {
            $http.sites[key].token = user.local.sites[key].token;
            $http.sites[key].config = {
              "headers": {
                "Authorization": "Bearer " + user.local.sites[key].token
              }
            };
          })
        };
        const refreshTokens = function () {
          $interval(() => {
            $http.post($http.sites.main.url + '/api/refresh-login', null, $http.sites.main.config).then(function (data) {
              var callback, error1, j, len1;
              loading = false;
              if (data && data.data && data.data !== 'error' && data.status !== 401) {
                handleUser(data.data);
              }
            });
          }, 1 * 60 * 1000);
        };
        refreshTokens();
        getUserPromise = function () {
          var defer;
          loading = true;
          defer = $q.defer();
          if (user) {
            defer.resolve(user);
            loading = false;
          } else {
            if (!$http.sites.main.token) {
              $http.sites.main.token = localStorage.getItem('token');
              $http.sites.main.config = { headers: { Authorization: 'Bearer ' + $http.sites.main.token } };
            }
            $http.post($http.sites.main.url + '/api/refresh-login', null, $http.sites.main.config).then(function (data) {
              var callback, error1, j, len1;
              loading = false;
              if (data && data.data && data.data !== 'error' && data.status !== 401) {
                handleUser(data.data);
                for (j = 0, len1 = userCallbacks.length; j < len1; j++) {
                  callback = userCallbacks[j];
                  try {
                    if (typeof callback === "function") {
                      callback(user);
                    }
                  } catch (error1) {
                    e = error1;
                    false;
                  }
                }
                userCallbacks = [];
                if (sockets) {
                  const allSockets = $injector.get('socket');
                  allSockets.forEach(socket => {

                    socket.io.emit('user', user);
                  })
                }
                return defer.resolve(user);
              } else {
                user = null;
                return defer.reject({});
              }
            }, function () {
              loading = false;
              user = null;
              return defer.reject({});
            });
          }
          return defer.promise;
        };
        hasRole = function (role) {
          var allgood, getKey, j, k, key, keys, len1, root;
          getKey = function (root, key) {
            return root[key];
          };
          let site = null;
          if (/:/.test(role)) [site, role] = role.split(/:/);
          site = site || settings.site;
          keys = role.split(/\./g);
          allgood = false;
          const roles = {};
          roles[(user.local.sites[site] || {}).role] = {};
          if (roles) {
            root = roles;
            for (j = 0, len1 = keys.length; j < len1; j++) {
              key = keys[j];
              if (key === '*') {
                for (k in root) {
                  root = root[k];
                  break;
                }
              } else {
                root = getKey(root, key);
              }
              if (root) {
                allgood = true;
              } else {
                allgood = false;
                break;
              }
            }
          }
          return allgood;
        };
        checkRoles = function (role, isAnd) {
          var getRole, j, len1, r, rolesToCheck, truth;
          rolesToCheck = [];
          getRole = function (role) {
            var j, len1, r, results, type;
            type = Object.prototype.toString.call(role);
            if (type === '[object Array]') {
              results = [];
              for (j = 0, len1 = role.length; j < len1; j++) {
                r = role[j];
                results.push(getRole(r));
              }
              return results;
            } else if (type === '[object Function]') {
              r = role(req);
              return getRole(r);
            } else if (type === '[object String]') {
              if (rolesToCheck.indexOf(role) === -1) {
                return rolesToCheck.push(role);
              }
            }
          };
          getRole(role);
          truth = isAnd ? true : false;
          for (j = 0, len1 = rolesToCheck.length; j < len1; j++) {
            r = rolesToCheck[j];
            if (isAnd) {
              truth = truth && hasRole(r);
            } else {
              truth = truth || hasRole(r);
            }
          }
          return truth;
        };
        return {
          getPromise: function (role, isAnd) {
            var defer;
            defer = $q.defer();
            if (Object.prototype.toString.call(role) === '[object Boolean]' && role === false) {
              defer.resolve({});
            } else {
              getUserPromise().then(function () {
                var truth;
                if (role) {
                  truth = checkRoles(role, isAnd);
                  if (truth) {
                    return defer.resolve(user);
                  } else {
                    $state.go(settings.redirect);
                    return defer.reject({});
                  }
                } else {
                  return defer.resolve(user);
                }
              }, function () {
                if (!role) {
                  return defer.resolve({});
                } else {
                  $state.go(settings.redirect);
                  return defer.reject({});
                }
              });
            }
            return defer.promise;
          },
          clearUser: function () {
            return user = null;
          },
          getUser: function () {
            return user;
          },
          loggedIn: function () {
            return user || $state.current.name === 'invited' || $state.current.name === 'forgot' || $state.current.name === 'forgot-response';
          },
          loading: function () {
            return loading;
          },
          checkRoles: function (role) {
            if (user) {
              return checkRoles(role);
            }
          },
          checkAllRoles: function (role) {
            if (user) {
              return checkRoles(role, true);
            }
          },
          isAuthorized: function (stateName) {
            var j, len1, ref, ref1, ref2, ref3, roles, sName;
            if (user) {
              if (Object.prototype.toString.call(stateName) === '[object Array]') {
                for (j = 0, len1 = stateName.length; j < len1; j++) {
                  sName = stateName[j];
                  roles = (ref = $state.get(sName)) != null ? (ref1 = ref.data) != null ? ref1.auth : void 0 : void 0;
                  if (!roles) {
                    return true;
                  }
                  if (checkRoles(roles)) {
                    return true;
                  }
                }
                return false;
              } else {
                roles = (ref2 = $state.get(stateName)) != null ? (ref3 = ref2.data) != null ? ref3.auth : void 0 : void 0;
                if (!roles) {
                  const bits = stateName.split(/_/g);
                  let site = bits[0];
                  if (bits.length === 3) site = bits[0] + '_' + bits[1];
                  const userSite = user.local.sites[site];
                  return (userSite || { role: 'no access' }).role !== 'no access';
                  return user.local.sites[site];
                }
                return checkRoles(roles);
              }
            }
          },
          canEdit: function (stateName) {
            var ref, ref1, ref2, ref3, roles;
            if (user) {
              roles = ((ref = $state.get(stateName)) != null ? (ref1 = ref.data) != null ? ref1.edit : void 0 : void 0) || ((ref2 = $state.get(stateName)) != null ? (ref3 = ref2.data) != null ? ref3.auth : void 0 : void 0);
              return checkRoles(roles);
            }
          },
          redirect: settings.redirect,
          goToNext: function () {
            if (current) {
              $state.go(current, currentParams);
              if (current !== prev || JSON.stringify(currentParams) !== JSON.stringify(prevParams)) {
                prev = current;
                return prevParams = currentParams;
              }
            } else {
              if (settings.redirect) {
                return $state.go(settings.redirect);
              }
            }
          },
          goToErrorRedirect: function () {
            if (errorRedirect) {
              $state.go(errorRedirect, errorRedirectParams);
              errorRedirect = '';
              return errorRedirectParams = void 0;
            } else {
              if (settings.redirect) {
                return $state.go(settings.redirect);
              }
            }
          },
          goToLast: function (_default, defaultParams) {
            if (prev) {
              return $state.go(prev, prevParams);
            } else if (_default) {
              return $state.go(_default, defaultParams);
            } else {
              if (settings.redirect) {
                return $state.go(settings.redirect);
              }
            }
          },
          logOut: function () {
            if (sockets) {
              const allSockets = $injector.get('socket');
              allSockets.forEach(socket => {

                socket.io.emit('user', null);
              })
            }
            user = null;
            localStorage.setItem('token', '');
            Object.keys($http.sites).forEach(key => $http.sites[key].token = null);
            //$http.get($http.sites.main.url + '/api/logout', $http.sites.main.config);
            $state.go('dashboard');
          },
          onUser: function (func) {
            if (user) {
              return typeof func === "function" ? func(user) : void 0;
            } else {
              if (userCallbacks.indexOf(func) === -1) {
                return userCallbacks.push(func);
              }
            }
          },
          config: function (args) {
            return angular.extend(settings, args);
          },
          settings: settings,
          current: function (_current, _currentParams) {
            if (_current === 'logged-out') {
              return;
            }
            if (prev !== current || prevParams !== currentParams) {
              prev = current;
              prevParams = Object.assign({}, currentParams);
            }
            current = _current;
            return currentParams = _currentParams;
          },
          errorRedirect: function (_errorRedirect, _errorRedirectParams) {
            errorRedirect = _errorRedirect;
            return errorRedirectParams = _errorRedirectParams;
          },
          setPrev: function (_prev, _prevParams) {
            prev = _prev;
            return prevParams = _prevParams || null;
          },
          setTitle: function (title) {
            var ref;
            title = title || ((ref = $state.current.data) != null ? ref.title : void 0);
            return document.title = "" + (settings.titlePrefix || '') + title + (settings.titleSuffix || '');
          },
          genId: genId,
          regenerateAnonId: function () {
            var anonId;
            anonId = genId(24);
            localStorage.setItem('anonId', anonId);
            return $http.defaults.headers.common['Anon-Id'] = anonId;
          }
        };
      }
    };
  }).run(function ($rootScope, $state, $stateParams, $transitions, $q, $http, Auth) {
    var anonId, root;
    if (Auth.settings.anonymousUser) {
      if (localStorage) {
        anonId = localStorage.getItem('anonId');
        anonId = anonId || Auth.genId(24);
        localStorage.setItem('anonId', anonId);
        $http.defaults.headers.common['Anon-Id'] = anonId;
      }
    }
    root = Object.getPrototypeOf($rootScope);
    root.auth = Auth;
    $transitions.onBefore({}, function (trans) {
      var data, defer;
      Auth.settings.site = 'main';
      const pattern = trans.$to().url.pattern;
      ['lettings', 'leads', 'maintenance_leads', 'maintenance', 'agency', 'myproperty'].forEach(name => {
        if (pattern.indexOf(name) === 1) Auth.settings.site = name;
      });
      defer = $q.defer();
      data = trans.$to().data || {};
      if (data.auth) {
        Auth.getPromise(data.auth).then(function () {
          Auth.current(trans.$to().name, trans.params());
          return defer.resolve();
        }, function () {
          trans.abort();
          $state.go('main_dashboard');
          Auth.errorRedirect('main_dashboard', trans.params());
          return defer.resolve();
        });
      } else {
        Auth.getPromise(null).then(function () {
          Auth.current(trans.$to().name, trans.params());
          return defer.resolve();
        }, function () {
          Auth.current(trans.$to().name, trans.params());
          return defer.resolve();
        });
      }
      return defer.promise;
    });
    return $transitions.onStart({}, function (trans) {
      var title;
      title = (trans.$to().data || {}).title || '';
      if (Auth.settings) {
        if (Auth.loggedIn()) {
          Auth.setTitle(title);
        } else {
          Auth.setTitle('Login');
        }
      }
      return trans;
    });
  });

}).call(this);

//# sourceMappingURL=ndx-auth.js.map
