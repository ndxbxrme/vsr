angular.module('vs-sms').config(function($stateProvider) {
  return $stateProvider.state('sms_dashboard', {
    url: '/sms',
    template: '<sms-dashboard></sms-dashboard>',
    data: {
      title: 'Vitalspace SMS - Dashboard',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})