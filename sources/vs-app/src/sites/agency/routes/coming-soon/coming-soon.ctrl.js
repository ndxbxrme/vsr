import './coming-soon.styl'
angular.module('vs-agency')
.directive('agencyComingSoon', function(alert, env) {
  return {
    template: require('./coming-soon.html').default,
    scope: {},
    link: (scope) => {
      scope.page = 1;
      scope.limit = 15;
      scope.sort = 'dateOfPhotos'; // Default sort by Date of Photos, earliest first
      scope.nodeleted = 0;
      scope.pageChange = function() {
        return $('html, body').animate({
          scrollTop: 0
        }, 200);
      };
      const assignUsers = () => {
        if(!scope.instructions || !scope.instructions.items || !scope.users || !scope.users.items) return;
        scope.instructions.items.forEach(instruction => {
          if(typeof(instruction.user==='string')) {
            const user = scope.users.items.find((user) => user.displayName === instruction.user);
            if(user) {
              instruction.user = {
                displayName: user.displayName,
                email: user.local.email
              };
            }
          }
          // Update SearchField after user assignment
          instruction.SearchField = [
            instruction.address,
            instruction.vendorsName,
            instruction.user && instruction.user.displayName,
            instruction.photographer
          ].filter(Boolean).join(' ');
        })
      }
      scope.users = scope.list('main:users', null, (users) => {
        assignUsers();
      });
      scope.instructions = scope.list('leads:instructions', null, (instructions) => {
        instructions.items.forEach(item => {
          if(item.insertedOn) item.insertedOn = new Date(item.insertedOn);
          if(item.goLiveDate) item.goLiveDate = new Date(item.goLiveDate);
          if(item.dateOfPhotos) item.dateOfPhotos = new Date(item.dateOfPhotos);
          // Convert fee to number if it's a string
          if(item.fee) item.fee = parseFloat(item.fee);
          if(item.askingPrice) item.askingPrice = parseFloat(item.askingPrice);
          // Convert percentage to actual amount
          if(item.fee && item.fee <= 1 && item.askingPrice) item.fee = (item.fee * item.askingPrice * 0.01);
          // Create SearchField for filtering
          item.SearchField = [
            item.address,
            item.vendorsName,
            item.user && item.user.displayName,
            item.photographer
          ].filter(Boolean).join(' ');
        })
        assignUsers();
      });
      scope.save = (item) => {
        scope.instructions.save(item);
        alert.log('Data saved');
      }
      scope.completeInstruction = (item) => {
        scope.instructions.delete(item);
        alert.log('New instruction completed');
      };
      scope.feeDP = (fee) => {
        return fee - Math.floor(fee) > 0 ? 2 : 0;
      }
      scope.getTotalFees = () => {
        if(!scope.instructions || !scope.instructions.items) return 0;
        return scope.instructions.items.reduce((total, item) => {
          return total + (item.fee || 0);
        }, 0);
      }
      scope.getTotalInstructions = () => {
        if(!scope.instructions || !scope.instructions.items) return 0;
        return scope.instructions.items.length;
      }
      scope.getNextPhotosDate = () => {
        if(!scope.instructions || !scope.instructions.items) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const futureDates = scope.instructions.items
          .filter(item => item.dateOfPhotos && new Date(item.dateOfPhotos) > today)
          .map(item => new Date(item.dateOfPhotos))
          .sort((a, b) => a - b);
        return futureDates.length > 0 ? futureDates[0] : null;
      }
      scope.item = {
        'uid': 123,
        'address': '7 Montrose Ave, Stretford Manchester M32 9LN',
        'vendorName': 'Ms Ann Woodrow',
        'user': {
          'displayName': 'Sally Bennet',
          'email': 'sally@vitalspace.co.uk'
        },
        'instructedOn': '',
        'askingPrice': '300000',
        'fee': '2500'
        
      }
    }
  }
});