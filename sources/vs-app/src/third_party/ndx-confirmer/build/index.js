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

  module.provider('Confirmer', function() {
    var modalOpen, styles, template;
    modalOpen = false;
    styles = "<style type=\"text/css\"> .confirm-backdrop { position: fixed; display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; top: 0; left: 0; background: rgba(0,0,0,0.1); transition: 0.1s; opacity: 0; z-index: 9999 } .confirm-backdrop .confirm-box { margin: 1rem; box-sizing: border-box; padding: 2rem; border-radius: 0.4rem; box-shadow: 0 0.61rem 1.28rem rgba(57,74,88,0.182); background: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; transition: 0.2s; opacity: 0; transform: translate3D(0, 50px, 0); } .confirm-backdrop.open { opacity: 1; } .confirm-backdrop.open .confirm-box { opacity: 1; transform: translate3D(0, 0, 0); } .controls {margin-top: 20px;} .confirm-box h1 {margin-top: 0px; color: #f15b25}</style>";
    template = "<div class=\"confirm-backdrop {{class}}\" ng-click=\"backdropClick($event)\"> <div class=\"confirm-box\" ng-click=\"boxClick($event)\"><i class=\"{{iconClass}}\">{{iconText}}</i> <h1 class=\"title\">{{title}}</h1> <div class=\"message\">{{message}}</div> <div class=\"controls\"> <button class=\"button button-green ok {{okClass}}\" ng-click=\"ok()\">{{okText}}</button> <button class=\"button cancel {{cancelClass}}\" ng-click=\"cancel()\">{{cancelText}}</button> </div> </div> </div>";
    return {
      setTemplate: function(_template) {
        return template = _template;
      },
      setStyles: function(_styles) {
        return styles = _styles;
      },
      $get: function($templateCache, $compile, $document, $window, $rootScope, $timeout, $q) {
        var body;
        body = $document.find('body').eq(0);
        body.append(styles);
        return {
          confirm: function(args) {
            var animTime, backdropCancel, close, com, defer, keyDown, myScope, open;
            defer = $q.defer();
            myScope = (args.scope || $rootScope).$new();
            myScope.message = args.message || myScope.message;
            myScope.title = args.title || myScope.title;
            myScope.okText = args.okText || myScope.okText || 'OK';
            myScope.cancelText = args.cancelText || myScope.cancelText || 'Cancel';
            myScope.iconText = args.iconText || myScope.iconText;
            myScope.okClass = args.okClass || myScope.okClass;
            myScope.cancelClass = args.cancelClass || myScope.cancelClass;
            myScope.iconClass = args.iconClass || myScope.iconClass;
            backdropCancel = args.backdropCancel || myScope.backdropCancel;
            animTime = 200;
            if (angular.isDefined(args.animTime)) {
              animTime = args.animTime;
            }
            com = null;
            keyDown = function(ev) {
              if (ev.keyCode === 27) {
                return close();
              }
            };
            close = function() {
              com.removeClass('open');
              $window.removeEventListener('keydown', keyDown);
              return $timeout(function() {
                modalOpen = false;
                return com.remove();
              }, animTime);
            };
            open = function() {
              var el;
              if (!modalOpen) {
                modalOpen = true;
                if (args.template) {
                  el = $templateCache.get(args.template);
                } else {
                  el = template;
                }
                com = $compile(el)(myScope);
                body.append(com);
                $window.addEventListener('keydown', keyDown);
                return $timeout(function() {
                  com.find('button')[0].focus();
                  return com.addClass('open');
                });
              }
            };
            myScope.ok = function() {
              defer.resolve(true);
              return close();
            };
            myScope.cancel = function() {
              defer.reject(true);
              return close();
            };
            myScope.boxClick = function(ev) {
              return ev.stopPropagation();
            };
            myScope.backdropClick = function(ev) {
              if (backdropCancel) {
                myScope.cancel();
              }
              return ev.stopPropagation();
            };
            open();
            return defer.promise;
          }
        };
      }
    };
  });

}).call(this);

//# sourceMappingURL=index.js.map
