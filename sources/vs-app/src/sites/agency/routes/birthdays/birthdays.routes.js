(function() {
  'use strict';
  angular.module('vs-agency').config(function($stateProvider) {
    return $stateProvider.state('agency_birthdays', {
      url: '/agency/birthdays',
      template: require("./birthdays.html").default,
      controller: 'agencyBirthdaysCtrl',
      data: {
        title: 'Vitalspace Conveyancing - Birthdays',
		auth: ['agency:superadmin', 'agency:admin']
      },
      resolve: {
        user: function(Auth) {
          return Auth.getPromise(['agency:superadmin', 'agency:admin']);
        }
      }
    });
  });

}).call(this);
