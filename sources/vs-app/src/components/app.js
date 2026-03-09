angular.module('vs-app')
.config(function($locationProvider, $urlRouterProvider, gravatarServiceProvider) {
  $urlRouterProvider.otherwise('/');
  $locationProvider.html5Mode(true);
  return gravatarServiceProvider.defaults = {
    size: 40,
    "default": 'mm',
    rating: 'pg'
  };
})
.run(function($rootScope, $state, progressionPopup, $http, $transitions, ndxModal, env, TaskPopup, MaintenanceTaskPopup, socket, Auth) {
  var root;
  $http.defaults.headers.common.Authorization = `Bearer ${env.PROPERTY_TOKEN}`;
  $rootScope.state = function(route) {
    if ($state && $state.current) {
      if (Object.prototype.toString.call(route) === '[object Array]') {
        return route.indexOf($state.current.name) !== -1;
      } else {
        return route === $state.current.name;
      }
    }
    return false;
  };
  $transitions.onBefore({}, function(trans) {
    if (!TaskPopup.getHidden()) {
      TaskPopup.hide();
      return TaskPopup.cancelBubble = true;
    }
    if (!MaintenanceTaskPopup.getHidden()) {
      MaintenanceTaskPopup.hide();
      return MaintenanceTaskPopup.cancelBubble = true;
    }
    if (trans.$from().name) {
      progressionPopup.hide();
      return $('body').removeClass(`${trans.$from().name}-page`);
    }
  });
  $transitions.onFinish({}, function(trans) {
    if (trans.$to().name) {
      return $('body').addClass(`${trans.$to().name}-page`);
    }
  });
  $rootScope.makeDownloadUrl = function(site, document) {
    if (document) {
      return $http.sites[site].url + '/api/download/' + btoa(JSON.stringify({
        path: document.path,
        filename: document.originalFilename
      }));
    }
  };
  root = Object.getPrototypeOf($rootScope);
  root.generateId = function(len) {
    var i, letters, output;
    letters = "abcdefghijklmnopqrstuvwxyz0123456789";
    output = '';
    i = 0;
    while (i++ < len) {
      output += letters[Math.floor(Math.random() * letters.length)];
    }
    return output;
  };
  root.hidePopup = function(ev) {
    return progressionPopup.hide();
  };
  root.modal = function(args) {
    var backdrop, controller, modalInstance, size;
    size = args.size || 'large';
    controller = args.controller || 'YesNoCancelCtrl';
    backdrop = args.backdrop || 'static';
    modalInstance = ndxModal.open({
      template: args.template,
      windowClass: size,
      controller: controller,
      backdrop: backdrop,
      resolve: {
        data: function() {
          return args.data;
        }
      }
    });
    return modalInstance.result;
  };
  root.selectById = function(list, id) {
    var item, j, len1, output;
    output = null;
    if (list && list.length) {
      for (j = 0, len1 = list.length; j < len1; j++) {
        item = list[j];
        if (item._id === id) {
          output = item;
          break;
        }
      }
    }
    return output;
  };
  Auth.onUser(function() {
    return root.users = $rootScope.list('maintenance:users', null, function(users) {
      var j, len1, ref, results, user;
      root.maintenance = [];
      root.staff = [];
      ref = users.items;
      results = [];
      for (j = 0, len1 = ref.length; j < len1; j++) {
        user = ref[j];
        if (user.roles) {
          if (user.roles.maintenance) {
            root.maintenance.push(user);
            if (!$rootScope.selectedUser) {
              $rootScope.selectedUser = user;
            }
          }
          if (user.roles.agency) {
            results.push(root.staff.push(user));
          } else {
            results.push(void 0);
          }
        } else {
          results.push(void 0);
        }
      }
      return results;
    });
  });
  $rootScope.bodyTap = function(e) {
    var elm, isPopup;
    $rootScope.mobileMenuOut = false;
    elm = e.target;
    isPopup = false;
    while (elm && elm.tagName !== 'BODY') {
      if (elm.className === 'popup') {
        isPopup = true;
        break;
      }
      elm = elm.parentNode;
    }
    if (!isPopup) {
      if (!MaintenanceTaskPopup.getHidden()) {
        MaintenanceTaskPopup.hide();
        return MaintenanceTaskPopup.cancelBubble = true;
      }
      if (!TaskPopup.getHidden()) {
        TaskPopup.hide();
        return TaskPopup.cancelBubble = true;
      }
    }
  };
  $rootScope.medium = 'dd/MM/yyyy @ HH:mm';
  if (false && socket) {
    socket.on('newIssue', function(issue) {
      return alert.log('<i class="fad fa-house-damage"></i><h3>' + issue.address + '</h3><p>' + issue.title + '</p>');
    });
    return socket.on('newMessage', function(message) {
      return alert.log('<i class="fad fa-house-damage"></i><h3>' + message.address + '</h3><h4>' + message.from + '</h4><p>' + message.subject + '</p>');
    });
  }
})