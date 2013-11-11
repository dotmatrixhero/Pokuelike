#ifndef _Menu_hpp_
#define _Menu_hpp_

#include <string>
#include <vector>
#include <memory>

#include <libtcod.hpp>

class Menu
{
    public:
    struct MenuItem
    {
        std::string label;
        bool selectable;
        Menu* menu;
    };

    public:
    Menu();
    // Menu(std::vector<std::string> list);
    ~Menu();

    // Menu Setup
    void addItem(const std::string& label);
    void addItems(const std::vector<std::string> items);

    void addLabel(const std::string& label);

    void addMenu(const std::string& label);
    void endMenu();
    void finalize();

    // Core Menu methods.
    void draw(int x, int y) const;
    void update();
    void handleInput(TCOD_key_t key);

    protected:
    void drawInternal(int x, int y) const;
    void handleInputInternal(TCOD_key_t key);
    void cleanup();

    void pushItem(const MenuItem& item);

    private:
    const int getLongest() const;

    private:
    TCODConsole* console;

    std::vector<MenuItem> items;
    std::vector<Menu*> menuStack;
    int selectionId;
    bool finished;
};

#endif // _Menu_hpp_
