const {propertyAdminFunctions, initForSale} = require('../../../../services/property-admin-functions.js');
(function () {
  'use strict';
  angular.module('vs-agency').controller('agencyClientManagementDetailsCtrl', function ($scope, $stateParams, $state, $timeout, $interval, $http, $window, Auth, AgencyProgressionPopup, agencyProperty, Upload, env, alert) {
    propertyAdminFunctions($scope, alert);
    let fetchedFirst = false;
    let propertyWhere = $stateParams.id;
    if($stateParams.roleid) propertyWhere = {RoleId:+$stateParams.roleid};
    $scope.property = $scope.single('agency:clientmanagement', propertyWhere, function (res) {
      var property;
      let adminFetched = false;
      property = res.item;
      property.displayAddress = `${property.Address.Number} ${property.Address.Street}, ${property.Address.Locality}, ${property.Address.Town}, ${property.Address.Postcode}`;
      if (!fetchedFirst) {
        fetchDetails();
        $scope.propertyadmin = $scope.single('main:propertyadmin', { RoleId: +property.RoleId }, (propertyadmin) => {
          if(!adminFetched) {
            initForSale(propertyadmin, property, $scope.auth.getUser());
          }
          adminFetched = true;
          return propertyadmin;
        });
      }
      fetchedFirst = true;
      return;
    });
    $scope.boardsList = $scope.list('main:boards');
    $scope.date = {
      date: 'today'
    };
    $scope.addNote = function () {
      var i, len, mynote, property, ref;
      if ($scope.note) {
        property = $scope.property.item;
        if (property) {
          if ($scope.note.date) {
            if (property.notes) {
              ref = property.notes;
              for (i = 0, len = ref.length; i < len; i++) {
                mynote = ref[i];
                if (mynote.date === $scope.note.date && mynote.item === $scope.note.item && mynote.side === $scope.note.side) {
                  mynote.text = $scope.note.text;
                  mynote.updatedAt = new Date();
                  mynote.updatedBy = Auth.getUser();
                }
              }
            }
          } else {
            if (!property.notes) {
              property.notes = [];
            }
            property.notes.push({
              date: new Date(),
              text: $scope.note.text,
              item: 'Case Note',
              side: '',
              user: Auth.getUser()
            });
          }
          $scope.property.save();
          alert.log('Note added');
          return $scope.note = null;
        }
      }
    };
    $scope.editNote = function (note) {
      $scope.note = JSON.parse(JSON.stringify(note));
      return $('.add-note')[0].scrollIntoView(true);
    };
    $scope.deleteNote = function (note) {
      var i, len, mynote, property, ref;
      property = $scope.property.item;
      if (property.notes) {
        ref = property.notes;
        for (i = 0, len = ref.length; i < len; i++) {
          mynote = ref[i];
          if (mynote.date === note.date && mynote.item === note.item && mynote.side === note.side) {
            property.notes.remove(mynote);
            break;
          }
        }
      }
      $scope.property.save();
      alert.log('Note deleted');
      return $scope.note = null;
    };
    $scope.getNotes = function () {
      var ref, ref1;
      return (ref = $scope.property) != null ? (ref1 = ref.item) != null ? ref1.notes : void 0 : void 0;
    };
    $scope.events = { Collection: [] };
    $scope.rightmove = {};
    const fetchDetails = async () => {
      const rmres = await $http.get('https://server.vitalspace.co.uk/dezrez/stats/rightmove/' + $scope.property.item.RoleId);
      if (rmres && rmres.data) {
        $scope.rightmove = rmres.data;
      }
      const res = await $http.get('https://server.vitalspace.co.uk/dezrez/role/' + $scope.property.item.RoleId + '/events');
      if (res && res.data) {
        $timeout(() => {
          $scope.events = { Collection: res.data };
        })
      }
      //$http.post('https://server.vitalspace.co.uk/dezrez/refresh/' + $scope.property.item.RoleId);
    }

    // consultant
    $scope.consultants = $scope.list('main:users', null, (users) => {
      users.items = users.items.filter(user => {
        const siteRole = user.siteRoles && user.siteRoles.find(role => role.siteId==='agency' && user.displayName!=='lettings');
        if(user.email==='richard@vitalspace.co.uk') return true;
        if(siteRole) {
          return siteRole.role==='agency' || siteRole.role==='admin';
        }
        return false;
      }).sort((a, b) => a.displayName > b.displayName ? 1 : -1);
    });
    const iv = $interval(fetchDetails, 10 * 60 * 1000);
    //fetchDetails();
    $scope.$on('$destroy', () => {
      $interval.cancel(iv);
    });
  });

}).call(this);
