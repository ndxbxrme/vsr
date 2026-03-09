angular.module('vs-agency').config(function($stateProvider) {
  return $stateProvider.state('agency_new-instruction', {
    url: '/agency/new-instruction',
    template: '<agency-new-instruction></agency-new-instruction>',
    data: {
      title: 'Vitalspace Agency - New Instruction',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})