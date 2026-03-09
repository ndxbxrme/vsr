angular.module('vs-maintenance').config(function($stateProvider) {
  'use strict';
  $stateProvider.state('maintenance_agenda', {
    url: '/maintenance/agenda',
    template: require('./agenda.html').default,
    controller: 'maintenanceAgendaCtrl',
    data: {
      title: 'Vitalspace Maintenance - Agenda'
    },
    resolve: {
      user: function(Auth) {
        return Auth.getPromise();
      }
    }
  });
});
