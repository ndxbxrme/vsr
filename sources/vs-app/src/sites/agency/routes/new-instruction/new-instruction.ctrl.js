
angular.module('vs-agency')
.directive('agencyNewInstruction', function(alert, env, $state, $stateParams) {
  return {
    template: require('./new-instruction.html').default,
    scope: {},
    link: (scope) => {
      scope.instruction = scope.single('leads:instructions', $stateParams.id);
      scope.save = function() {
        if (scope.myForm.$valid) {
          const user = scope.auth.getUser();
          scope.instruction.item.user = user.displayName;
          scope.instruction.item.date = new Date();
          scope.instruction.item.insertedOn = new Date();
          scope.instruction.uid = Math.floor(Math.random() * 999999999).toString('26');
          scope.instruction.save();
          scope.myForm.$setPristine();
          alert.log('New Instruction Added');
          return $state.go('agency_coming-soon');
        }
      };
      scope.cancel = function() {
        return state.go('agency_coming-soon');
      };
    }
  }
});