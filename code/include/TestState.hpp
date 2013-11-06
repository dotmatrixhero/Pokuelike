#ifndef _TestState_hpp_
#define _TestState_hpp_

#include "State.hpp"
#include <libtcod.hpp>

class TestState : public State
{
    public:
    TestState(StateStack& stateStack);
    ~TestState();

    void draw();
    bool update();
    bool handleInput(TCOD_key_t key);

    private:
    int thingx;
    int thingy;
};

#endif // _TestState_hpp_
