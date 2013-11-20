#include "../include/TestState.hpp"
#include "../include/StateIdentifiers.hpp"

#include "../include/memutils.hpp"

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
    menu = std::unique_ptr<Menu>(new Menu({"Un", "Deux", "Trois", "Quatre", "Cinq", "Six", "Sept", "Huit", "Neuf"}));
}

TestState::~TestState()
{
}

void TestState::draw()
{
    TCODConsole::root->print(11, 10, "HELLO LIBTCOD WORLD!");
    menu->draw(15, 15);
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput(TCOD_key_t key)
{
    menu->handleInput(key);
    if (key.c == 'a')
        requestStackPush(States::Debug);

    return false;
}
