angular.module('vs-sms').config(function($stateProvider) {
  return $stateProvider.state('sms_schedule', {
    url: '/sms/schedule',
    template: '<sms-schedule></sms-schedule>',
    data: {
      title: 'Vitalspace SMS - Schedule',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})