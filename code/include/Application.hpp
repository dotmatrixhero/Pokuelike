#ifndef _Application_hpp_
#define _Application_hpp_

#include <libtcod.hpp>
#include "StateStack.hpp"
#include "StateIdentifiers.hpp"

class Application
{
    public:
    Application();
    void run(States::ID stateId);

    private:
    void registerStates();

    private:
    StateStack stateStack;
    bool quit;
};

#endif // _Application_hpp_
