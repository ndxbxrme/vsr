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

  module.run(function($rootScope, $window, $state, $timeout, $injector, $transitions, ndxCheck) {
    var rest, root;
    rest = $injector.get('rest');
    root = Object.getPrototypeOf($rootScope);
    root.redirect = 'back';
    root.saveFn = function(cb) {
      return typeof cb === "function" ? cb(true) : void 0;
    };
    root.cancelFn = function(cb) {
      return typeof cb === "function" ? cb(true) : void 0;
    };
    root.save = function(name) {
      var checkScope, isValid;
      isValid = true;
      checkScope = function(scope) {
        var key, results;
        results = [];
        for (key in scope) {
          if (scope.hasOwnProperty(key)) {
            if (Object.prototype.toString.call(scope[key]) === '[object Object]') {
              if (scope[key].$$controls) {
                results.push(isValid = isValid && scope[key].$valid);
              } else {
                results.push(void 0);
              }
            } else {
              results.push(void 0);
            }
          } else {
            results.push(void 0);
          }
        }
        return results;
      };
      checkScope(this);
      if (this.forms) {
        checkScope(this.forms);
      }
      this.submitted = true;
      if (isValid) {
        return this.saveFn((function(_this) {
          return function(result) {
            var adding, key, keys, message;
            if (result) {
              adding = true;
              keys = [];
              for (key in _this) {
                keys.push(key);
              }
              for (key in _this) {
                if (key.indexOf('$') === 0) {
                  continue;
                }
                if (Object.prototype.toString.call(_this[key]) === '[object Object]') {
                  if (_this[key].item) {
                    if (_this[key].item._id) {
                      adding = false;
                    }
                    _this[key].locked = false;
                    _this[key].save();
                  }
                }
              }
              _this.editing = false;
              ndxCheck.setPristine(_this);
              message = '';
              if (_this.messageFn) {
                message = _this.messageFn(name + "-alerts-" + (adding ? 'added' : 'updated'));
              } else {
                message = adding ? 'Added' : 'Updated';
              }
              if (_this.alertFn) {
                _this.alertFn(message);
              }
              if (rest) {
                rest.unlockAll();
              }
              if (_this.redirect) {
                if (_this.redirect === 'back') {
                  if ($rootScope.auth) {
                    return $rootScope.auth.goToLast(_this.defaultLast);
                  } else {
                    return $window.history.go(-1);
                  }
                } else {
                  return $state.go(_this.redirect);
                }
              }
            }
          };
        })(this));
      } else {
        if ($) {
          return $timeout(function() {
            var offset;
            offset = $('.error:visible').parent('.form-item').offset();
            if (offset) {
              return $('html, body').animate({
                scrollTop: offset.top - 72
              });
            }
          });
        }
      }
    };
    root.cancel = function() {
      return this.cancelFn((function(_this) {
        return function(result) {
          var key;
          if (result) {
            _this.submitted = false;
            _this.editing = false;
            for (key in _this) {
              if (_this.hasOwnProperty(key)) {
                if (Object.prototype.toString.call(_this[key]) === '[object Object]') {
                  if (_this[key].item) {
                    _this[key].locked = false;
                    _this[key].refreshFn();
                  }
                }
              }
            }
            ndxCheck.setPristine(_this);
            if (rest) {
              rest.unlockAll();
            }
            if (_this.redirect) {
              if (_this.redirect === 'back') {
                if ($rootScope.auth) {
                  return $rootScope.auth.goToLast(_this.defaultLast);
                } else {
                  return $window.history.go(-1);
                }
              } else {
                return $state.go(_this.redirect);
              }
            }
          }
        };
      })(this));
    };
    root.edit = function() {
      rest.lockAll();
      this.submitted = false;
      return this.editing = true;
    };
    if (rest) {
      return $transitions.onStart({}, function(trans) {
        rest.unlockAll();
        return true;
      });
    }
  });

}).call(this);

//# sourceMappingURL=index.js.map
